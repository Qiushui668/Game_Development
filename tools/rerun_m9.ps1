$ErrorActionPreference='Continue'
Set-Location E:\DoubaoWork\Game_Development
& .\.venv\Scripts\python.exe tools\verify_m9.py *> tools\verify_m9_rerun.log
"exit=$LASTEXITCODE" | Out-File tools\m9_rerun_status.txt -Encoding utf8
