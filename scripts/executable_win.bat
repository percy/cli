@echo off

REM Decode base64 encoded certificate and save to CodeSigning.p12
echo %WINDOWS_CERT% | base64.exe -d > CodeSigning.p12

REM Sign percy.exe using signtool
signtool.exe sign /fd SHA256 /f CodeSigning.p12 /p %WINDOWS_CERT_KEY% percy.exe

REM Create zip file containing percy.exe
powershell Compress-Archive -Path percy.exe -DestinationPath percy-win.zip
