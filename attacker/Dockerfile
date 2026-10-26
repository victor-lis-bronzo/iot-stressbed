FROM python:3.12-slim
ENV PIP_ROOT_USER_ACTION=ignore \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY python/ ./python/
# Runner HTTP (ADR-0012): o nestjs-api manda o ataque por aqui, pela rede interna.
# O container não dispara nada sozinho — só executa o que o api pede.
CMD ["python", "python/runner.py"]
