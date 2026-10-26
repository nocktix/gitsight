"""Los scripts de arranque no deben romperse según el idioma o la codificación del sistema.

El bash de macOS (3.2) toma los bytes no ASCII (como la «…» de un mensaje) como parte del nombre de
una variable cuando el locale es UTF-8: "$PUERTO…" se lee como la variable «PUERTO…» y, con
`set -u`, el script termina con "unbound variable". Por eso toda variable de start.sh va entre llaves.
"""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
START_SH = ROOT / "start.sh"
START_PS1 = ROOT / "start.ps1"
START_BAT = ROOT / "start.bat"


def _outside_single_quotes(line: str) -> str:
    """La línea sin el texto entre comillas simples (ahí `$1` es de awk, no de bash)."""
    return re.sub(r"'[^']*'", "''", line)


def test_every_shell_variable_in_start_sh_uses_braces():
    offenders = []
    for number, line in enumerate(START_SH.read_text(encoding="utf-8").splitlines(), start=1):
        if line.lstrip().startswith("#"):
            continue
        if re.search(r"\$[A-Za-z_0-9]", _outside_single_quotes(line)):
            offenders.append(f"línea {number}: {line.strip()}")
    assert offenders == [], "variables sin llaves (usa ${VAR}):\n" + "\n".join(offenders)


@pytest.mark.skipif(shutil.which("bash") is None, reason="bash no está instalado")
def test_start_sh_has_valid_syntax():
    result = subprocess.run(["bash", "-n", str(START_SH)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_windows_scripts_are_plain_ascii():
    # Windows PowerShell 5.1 lee un .ps1 sin BOM como ANSI: un carácter con tilde se deforma.
    for path in (START_PS1, START_BAT):
        text = path.read_bytes()
        bad = sorted({hex(b) for b in text if b > 127})
        assert bad == [], f"{path.name} tiene bytes no ASCII: {bad}"


def test_powershell_variables_in_strings_use_braces():
    offenders = []
    for number, line in enumerate(START_PS1.read_text(encoding="ascii").splitlines(), start=1):
        for string in re.findall(r'"[^"\n]*"', line):
            # $(...) es una subexpresión y $_ la variable automática: se dejan como están
            if re.search(r"\$(?![({_])[A-Za-z]", string):
                offenders.append(f"línea {number}: {string}")
    assert offenders == [], "variables sin llaves en cadenas:\n" + "\n".join(offenders)
