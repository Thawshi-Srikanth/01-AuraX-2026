@echo off
setlocal
set "AURAX_DEV_ROOT=%~dp0"
powershell.exe -NoLogo -NoProfile -Command "& { $ErrorActionPreference = 'Stop'; $project = $env:AURAX_DEV_ROOT.TrimEnd('\'); if ($project -match '^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)\\(.*)$') { $distro = $Matches[1]; $linux = '/' + $Matches[2].Replace('\', '/'); & wsl.exe --distribution $distro --cd $linux --exec sh ./dev @args; exit $LASTEXITCODE }; Push-Location -LiteralPath $project; try { & uv run --project backend --locked python scripts/dev.py @args; $result = $LASTEXITCODE } finally { Pop-Location }; exit $result }" %*
if errorlevel 1 if not defined CI pause
