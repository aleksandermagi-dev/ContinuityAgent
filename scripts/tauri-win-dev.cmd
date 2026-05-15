@echo off
setlocal
set "CARGO_HOME_PATH=%USERPROFILE%\.cargo\bin"
set "VS_VCVARS=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if exist "%VS_VCVARS%" (
  call "%VS_VCVARS%" >nul
)
set "PATH=%CARGO_HOME_PATH%;%PATH%"
npx tauri dev
