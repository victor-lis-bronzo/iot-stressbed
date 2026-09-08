import sys
from pathlib import Path

# Deixa `import args` / `import injector` resolverem para os módulos em
# attacker/python/ quando os testes rodam de qualquer diretório.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
