#!/usr/bin/env python3
"""Calcula a entropia de Shannon dos payloads TCP capturados em um .pcap.

Classifica o tráfego MQTT capturado (via scripts/capture-pcap.sh) como
"legivel" (texto puro, esperado no broker plain) ou "ciphertext" (TLS,
esperado no broker secure), com base na entropia por byte do payload.

Parser mínimo de pcap clássico (libpcap), sem dependências externas.
Suporta link-layer Ethernet (LINKTYPE_ETHERNET=1) e "Linux cooked capture"
(LINKTYPE_LINUX_SLL=113 / SLL2=276) — este último é o que `tcpdump -i any`
produz, o padrão de scripts/capture-pcap.sh. Não suporta pcapng nem pcap com
timestamps em nanossegundos.
"""
import argparse
import json
import math
import os
import struct
import sys
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

LINKTYPE_ETHERNET = 1
LINKTYPE_LINUX_SLL = 113
LINKTYPE_LINUX_SLL2 = 276

READABLE_THRESHOLD = 6.0
CIPHERTEXT_THRESHOLD = 7.5


def shannon_entropy(data: bytes) -> float:
    if not data:
        return 0.0
    counts = Counter(data)
    total = len(data)
    entropy = 0.0
    for count in counts.values():
        p = count / total
        entropy -= p * math.log2(p)
    return entropy


def classify(entropy: float) -> str:
    if entropy < READABLE_THRESHOLD:
        return "legivel"
    if entropy >= CIPHERTEXT_THRESHOLD:
        return "ciphertext"
    return "inconclusivo"


def read_pcap_records(data: bytes):
    if len(data) < 24:
        raise ValueError("arquivo pcap truncado (sem cabeçalho global)")

    magic = data[:4]
    if magic == b"\xa1\xb2\xc3\xd4":
        endian = ">"
    elif magic == b"\xd4\xc3\xb2\xa1":
        endian = "<"
    elif magic in (b"\xa1\xb2\x3c\x4d", b"\x4d\x3c\xb2\xa1"):
        raise ValueError(
            "pcap com timestamps em nanossegundos (magic ns) não suportado"
        )
    else:
        raise ValueError(
            "arquivo não parece ser um pcap clássico (magic number desconhecido) "
            "— formatos pcapng não são suportados por este parser"
        )

    network = struct.unpack(endian + "I", data[20:24])[0]
    offset = 24
    while offset + 16 <= len(data):
        _ts_sec, _ts_usec, incl_len, _orig_len = struct.unpack(
            endian + "IIII", data[offset : offset + 16]
        )
        offset += 16
        packet = data[offset : offset + incl_len]
        offset += incl_len
        yield network, packet


def strip_link_layer(network: int, packet: bytes) -> bytes | None:
    if network == LINKTYPE_ETHERNET:
        if len(packet) < 14:
            return None
        ethertype = struct.unpack(">H", packet[12:14])[0]
        payload = packet[14:]
        if ethertype == 0x8100:  # tag VLAN 802.1Q: mais 4 bytes antes do ethertype real
            if len(payload) < 4:
                return None
            payload = payload[4:]
        return payload
    if network == LINKTYPE_LINUX_SLL:
        if len(packet) < 16:
            return None
        return packet[16:]
    if network == LINKTYPE_LINUX_SLL2:
        if len(packet) < 20:
            return None
        return packet[20:]
    return None


def extract_tcp_payload(ip_packet: bytes, target_port: int) -> bytes | None:
    if len(ip_packet) < 20:
        return None
    version = ip_packet[0] >> 4
    if version != 4:
        return None  # IPv6 fora de escopo deste protocolo de verificação
    ihl = (ip_packet[0] & 0x0F) * 4
    if ihl < 20 or len(ip_packet) < ihl + 20:
        return None
    protocol = ip_packet[9]
    if protocol != 6:  # TCP
        return None
    tcp_segment = ip_packet[ihl:]
    src_port, dst_port = struct.unpack(">HH", tcp_segment[0:4])
    if target_port not in (src_port, dst_port):
        return None
    data_offset = (tcp_segment[12] >> 4) * 4
    if data_offset < 20 or len(tcp_segment) < data_offset:
        return None
    return tcp_segment[data_offset:]


def collect_payload(pcap_path: Path, port: int) -> bytes:
    data = pcap_path.read_bytes()
    payload = bytearray()
    for network, packet in read_pcap_records(data):
        link_payload = strip_link_layer(network, packet)
        if link_payload is None:
            continue
        tcp_payload = extract_tcp_payload(link_payload, port)
        if tcp_payload:
            payload.extend(tcp_payload)
    return bytes(payload)


def analyze(pcap_path: Path, port: int) -> dict:
    payload = collect_payload(pcap_path, port)
    entropy = shannon_entropy(payload)
    return {
        "file": str(pcap_path),
        "port": port,
        "payload_bytes": len(payload),
        "entropy_bits_per_byte": entropy,
        "classification": classify(entropy),
    }


def post_result(base_url: str, run_id: str, result: dict, token: str | None) -> None:
    body = json.dumps(
        {
            "entropyBits": result["entropy_bits_per_byte"],
            "classification": result["classification"],
        }
    ).encode("utf-8")
    url = f"{base_url}/metrics/runs/{run_id}/payload-readability"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            print(f"aviso: KPI registrado (status {resp.status})", file=sys.stderr)
    except (urllib.error.URLError, OSError) as exc:
        print(
            f"aviso: falha ao registrar KPI em {url} (não-fatal, endpoint pode "
            f"exigir autenticação — use isso apenas em ambiente de teste local): {exc}",
            file=sys.stderr,
        )


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plain", type=Path, help="caminho do .pcap capturado no broker plain")
    parser.add_argument("--secure", type=Path, help="caminho do .pcap capturado no broker secure")
    parser.add_argument(
        "--plain-port", type=int, default=1883, help="porta MQTT do broker plain (default 1883)"
    )
    parser.add_argument(
        "--secure-port", type=int, default=8883, help="porta MQTT do broker secure (default 8883)"
    )
    parser.add_argument(
        "--record-run-id",
        help="se informado, faz POST do resultado em "
        "<--api-base-url>/metrics/runs/<id>/payload-readability (falha não-fatal)",
    )
    parser.add_argument(
        "--api-base-url",
        default="http://localhost:3000",
        help="base da API para --record-run-id (default http://localhost:3000)",
    )
    parser.add_argument(
        "--api-token",
        default=os.environ.get("PCAP_ENTROPY_API_TOKEN"),
        help="bearer token JWT para autenticar em --record-run-id (o endpoint "
        "exige login; default: variável de ambiente PCAP_ENTROPY_API_TOKEN). "
        "Obtenha-o do mesmo jeito que scripts/run-experiment.sh, via "
        "POST /auth/login.",
    )
    args = parser.parse_args(argv)

    if args.record_run_id and not args.api_token:
        parser.error(
            "--record-run-id exige um token: use --api-token ou exporte "
            "PCAP_ENTROPY_API_TOKEN (POST /auth/login para obtê-lo)"
        )

    if not args.plain and not args.secure:
        parser.error("informe --plain e/ou --secure")

    results = []
    if args.plain:
        results.append(("plain", analyze(args.plain, args.plain_port)))
    if args.secure:
        results.append(("secure", analyze(args.secure, args.secure_port)))

    for label, result in results:
        print(
            f"[{label}] {result['file']}: {result['payload_bytes']} bytes de payload TCP, "
            f"entropia={result['entropy_bits_per_byte']:.3f} bits/byte -> "
            f"{result['classification']}"
        )
        if args.record_run_id:
            post_result(args.api_base_url, args.record_run_id, result, args.api_token)

    return 0


if __name__ == "__main__":
    sys.exit(main())
