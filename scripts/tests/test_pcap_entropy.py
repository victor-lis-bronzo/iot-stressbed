import importlib.util
import os
import struct
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve().parent.parent / "pcap-entropy.py"
_spec = importlib.util.spec_from_file_location("pcap_entropy", SCRIPT_PATH)
pcap_entropy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pcap_entropy)  # type: ignore[union-attr]


def build_tcp_packet(payload: bytes, src_port: int, dst_port: int) -> bytes:
    """Monta um pacote Ethernet+IPv4+TCP mínimo (sem opções) carregando payload."""
    eth = bytes(6) + bytes(6) + struct.pack(">H", 0x0800)
    total_len = 20 + 20 + len(payload)
    ip_header = struct.pack(
        ">BBHHHBBH4s4s",
        0x45,
        0,
        total_len,
        0,
        0,
        64,
        6,
        0,
        bytes([10, 0, 0, 1]),
        bytes([10, 0, 0, 2]),
    )
    tcp_header = struct.pack(
        ">HHIIBBHHH",
        src_port,
        dst_port,
        0,
        0,
        5 << 4,
        0x18,
        0,
        0,
        0,
    )
    return eth + ip_header + tcp_header + payload


def build_pcap(packets: list[bytes]) -> bytes:
    global_header = b"\xa1\xb2\xc3\xd4" + struct.pack(">HHIIII", 2, 4, 0, 0, 65535, 1)
    body = b""
    for packet in packets:
        body += struct.pack(">IIII", 0, 0, len(packet), len(packet)) + packet
    return global_header + body


def test_classifies_low_entropy_ascii_payload_as_readable(tmp_path):
    payload = b'{"temperature": 21.5, "humidity": 55.0}' * 20
    pcap_path = tmp_path / "plain.pcap"
    pcap_path.write_bytes(build_pcap([build_tcp_packet(payload, 55123, 1883)]))

    result = pcap_entropy.analyze(pcap_path, 1883)

    assert result["classification"] == "legivel"
    assert result["entropy_bits_per_byte"] < pcap_entropy.READABLE_THRESHOLD


def test_classifies_high_entropy_random_payload_as_ciphertext(tmp_path):
    payload = os.urandom(4096)
    pcap_path = tmp_path / "secure.pcap"
    pcap_path.write_bytes(build_pcap([build_tcp_packet(payload, 55124, 8883)]))

    result = pcap_entropy.analyze(pcap_path, 8883)

    assert result["classification"] == "ciphertext"
    assert result["entropy_bits_per_byte"] >= pcap_entropy.CIPHERTEXT_THRESHOLD


def test_ignores_packets_on_a_different_port(tmp_path):
    payload = b"irrelevant"
    pcap_path = tmp_path / "other.pcap"
    pcap_path.write_bytes(build_pcap([build_tcp_packet(payload, 12345, 9999)]))

    result = pcap_entropy.analyze(pcap_path, 1883)

    assert result["payload_bytes"] == 0
    assert result["entropy_bits_per_byte"] == 0.0
