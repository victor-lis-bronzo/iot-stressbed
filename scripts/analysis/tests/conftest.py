import sys
from pathlib import Path

# Deixa `import export_run_metrics` resolver para o módulo em scripts/analysis/
# quando os testes rodam de qualquer diretório (mesmo padrão de
# attacker/python/tests/conftest.py).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
