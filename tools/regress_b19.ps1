# B1.9 回归：老用例 + 新验收（服务端已重启、新代码已生效）
$ErrorActionPreference = 'Continue'
Set-Location E:\DoubaoWork\Game_Development
$py = '.\.venv\Scripts\python.exe'
$log = 'tools\regress_b19.log'
"=== START $(Get-Date -Format 'HH:mm:ss') ===" | Out-File $log -Encoding utf8

& "E:\Program Files\nodejs\npm.cmd" run build *> tools\build.log
"build exit=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8

foreach ($m in @('m2','m3','m4','m5','m6','m8','m9')) {
  & $py "tools\verify_$m.py" *> "tools\verify_$m.log"
  "$m exit=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8
}
& $py tools\verify_m7.py *> tools\verify_m7.log
"m7 exit=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8

& "E:\Program Files\nodejs\node.exe" tools\smoke_room_b18.mjs *> tools\smoke_b18.log
"smoke_b18 exit=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8

"=== END $(Get-Date -Format 'HH:mm:ss') ===" | Out-File $log -Append -Encoding utf8
