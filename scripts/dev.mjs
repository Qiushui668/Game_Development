/**
 * 一键局域网联调：同时起 Vite（0.0.0.0 监听）+ 房间服务端，并打印别人该访问的地址。
 * 用法：npm run lan
 */
import { spawn } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function lanIps() {
  const out = []
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) out.push(info.address)
    }
  }
  return out
}

const children = []
function launch(label, cmd, args) {
  const child = spawn(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  })
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.log(`[${label}] 退出，code=${code}`)
  })
  children.push(child)
  return child
}

launch('vite', npmCmd, ['run', 'dev:vite'])
launch('server', process.execPath, [resolve(root, 'server/index.mjs')])

const ips = lanIps()
console.log('\n[lan] 局域网联机地址（同一 WiFi / 同一路由器下可用）：')
if (ips.length === 0) {
  console.log('  没找到局域网 IPv4 地址，其他人只能用本机 localhost 访问')
} else {
  for (const ip of ips) {
    console.log(`  首页      http://${ip}:5173`)
    console.log(`  房间服务  ws://${ip}:8000/ws`)
  }
}
console.log('[lan] 本机调试仍可用 http://localhost:5173\n')

function shutdown() {
  for (const c of children) {
    try {
      c.kill()
    } catch {
      /* 忽略 */
    }
  }
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
