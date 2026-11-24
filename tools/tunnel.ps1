<#
一键公网演示（不需要服务器、不需要绑卡）：
  1) 确保 dist/ 已构建（没有就跑一次 npm run build）
  2) 起整站服务：前端 dist + 房间服务 /ws 同一个进程、同一个端口
  3) 起 Cloudflare 临时隧道，把它映射成 https://<随机>.trycloudflare.com
  4) 打印可以发给朋友的那个网址

用法（在仓库根目录）：
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\tunnel.ps1
可选：
  -Port 8000        本地端口（默认 8000）
  -Rebuild          强制重新构建前端

停止：关掉 cloudflared.exe 与 node（或直接结束本脚本拉起的两个进程即可）
#>
param(
  [int]$Port = 8000,
  [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$node = 'E:\Program Files\nodejs\node.exe'
$npm = 'E:\Program Files\nodejs\npm.cmd'
$logs = Join-Path $root 'tools'

# ---------- 1. 前端构建 ----------
$index = Join-Path $root 'dist\index.html'
if ($Rebuild -or -not (Test-Path -LiteralPath $index)) {
  Write-Host '[1/3] 构建前端（npm run build）…' -ForegroundColor Cyan
  & $npm run build
  if ($LASTEXITCODE -ne 0) { throw 'npm run build 失败，先修构建再看隧道' }
}

# ---------- 2. 整站服务 ----------
$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  Write-Host "[2/3] 起整站服务 0.0.0.0:$Port …" -ForegroundColor Cyan
  $env:PORT = "$Port"
  Start-Process -FilePath $node -ArgumentList 'server/index.mjs' -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs '_tunnel_srv.out') -RedirectStandardError (Join-Path $logs '_tunnel_srv.err') | Out-Null
  Start-Sleep -Seconds 3
} else {
  Write-Host "[2/3] 端口 $Port 已有服务在跑，直接复用" -ForegroundColor DarkGray
}

$health = $null
try { $health = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 10 } catch { throw "本地 /health 不通：$($_.Exception.Message)" }
Write-Host ("      本地健康检查: " + ($health | ConvertTo-Json -Compress)) -ForegroundColor DarkGray

# ---------- 3. 隧道 ----------
$cf = Join-Path $env:LOCALAPPDATA 'ppr-tools\cloudflared.exe'
if (-not (Test-Path -LiteralPath $cf)) {
  Write-Host '[3/3] 首次运行，下载 cloudflared …' -ForegroundColor Cyan
  New-Item -ItemType Directory -Force -Path (Split-Path $cf) | Out-Null
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $cf -TimeoutSec 300
}

# 同一个端口如果还有上一次留下的隧道，先关掉（避免端口上挂两条隧道、地址混淆）
$old = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*--url*localhost:$Port*" }
foreach ($o in $old) { Stop-Process -Id $o.ProcessId -Force -ErrorAction SilentlyContinue }
if ($old) { Write-Host "      已关掉 $Port 端口上一次的隧道（$($old.Count) 条）" -ForegroundColor DarkGray }

# 每次运行用独立日志名，别去删正在被别的进程占用的文件
$tunnelLog = Join-Path $logs ('_tunnel_' + $Port + '_' + (Get-Date -Format 'MMdd-HHmmss') + '.log')
Start-Process -FilePath $cf -ArgumentList 'tunnel', '--url', "http://localhost:$Port", '--no-autoupdate', '--logfile', $tunnelLog, '--loglevel', 'info' -WindowStyle Hidden | Out-Null

$url = ''
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 2
  if (Test-Path -LiteralPath $tunnelLog) {
    $m = Select-String -LiteralPath $tunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value; break }
  }
}
if (-not $url) {
  $tail = ''
  if (Test-Path -LiteralPath $tunnelLog) { $tail = (Get-Content -LiteralPath $tunnelLog -Tail 3) -join ' | ' }
  throw "隧道没拿到地址（Cloudflare 短时间反复申请会限流，等几分钟再试）。日志：$tunnelLog  末尾：$tail"
}

# 隧道刚建好时边缘路由还要几秒才生效，这里重试几次再下结论
$public = $null
for ($i = 1; $i -le 6; $i++) {
  try { $public = Invoke-RestMethod "$url/health" -TimeoutSec 25; break }
  catch { if ($i -lt 6) { Start-Sleep -Seconds 5 } }
}
if ($public) { Write-Host ("      公网健康检查: " + ($public | ConvertTo-Json -Compress)) -ForegroundColor DarkGray }
else { Write-Host '      公网 /health 还没起来（隧道刚建，等几秒刷新页面即可）' -ForegroundColor Yellow }

Write-Host ''
Write-Host '  把这个网址发给朋友（手机/电脑都能开）：' -ForegroundColor Green
Write-Host "  $url" -ForegroundColor Green
Write-Host ''
Write-Host '  提醒：这台电脑要一直开着、别睡眠；隧道重启后地址会变，重跑本脚本拿新链接即可。' -ForegroundColor DarkGray
$url | Out-File -Encoding utf8 (Join-Path $logs '_tunnel_url.txt')
