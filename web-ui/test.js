const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer()
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            server.close(() => resolve(address.port))
        })
    })
}

async function waitFor(url) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        try { if ((await fetch(url)).ok) return } catch {}
        await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Web UI 启动超时')
}

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rewards-gui-'))
    const port = await freePort()
    const base = `http://127.0.0.1:${port}`
    fs.mkdirSync(path.join(root, 'dist/config'), { recursive: true })
    fs.mkdirSync(path.join(root, 'dist/browser/sessions'), { recursive: true })
    const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
        env: {
            ...process.env,
            WEB_PORT: String(port),
            APP_ROOT: root,
            PUBLIC_DIR: path.join(__dirname, 'public'),
            LOCK_FILE: path.join(root, 'run.lock'),
            LOG_FILE: path.join(root, 'rewards.log')
        },
        stdio: 'ignore'
    })
    try {
        await waitFor(`${base}/health`)
        // 页面标题与自动调度 UI 元素存在
        const pageText = await (await fetch(`${base}/`)).text()
        assert.ok(pageText.includes('自动调度'))
        assert.ok(pageText.includes('scheduleForm'))
        // schedule 默认不开启
        const initialState = await (await fetch(`${base}/api/state`)).json()
        assert.equal(initialState.schedule.enabled, false)
        assert.deepEqual(initialState.schedule.nextRun, null)
        assert.deepEqual(initialState.accounts, [])
        assert.equal(initialState.log, '')
        assert.equal((await fetch(`${base}/api/stop`, { method: 'POST' })).status, 409)
        // 保存 interval 调度
        let saved = await (await fetch(`${base}/api/schedule`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: true, mode: 'interval', intervalValue: 30, intervalUnit: 'minutes' })
        })).json()
        assert.equal(saved.enabled, true)
        assert.equal(saved.mode, 'interval')
        assert.equal(saved.intervalValue, 30)
        assert.equal(saved.intervalUnit, 'minutes')
        assert.ok(saved.nextRun)
        // 非法 interval 值回退默认
        saved = await (await fetch(`${base}/api/schedule`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: true, mode: 'interval', intervalValue: 0, intervalUnit: 'days' })
        })).json()
        assert.equal(saved.intervalValue, 6)
        assert.equal(saved.intervalUnit, 'days')
        // 固定时间调度 + 时间非法校验
        saved = await (await fetch(`${base}/api/schedule`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: true, mode: 'daily', time: '99:99' })
        })).json()
        assert.equal(saved.mode, 'daily')
        assert.equal(saved.time, '07:00')
        saved = await (await fetch(`${base}/api/schedule`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: true, mode: 'daily', time: '08:30' })
        })).json()
        assert.equal(saved.time, '08:30')
        assert.ok(saved.nextRun)
        // 关闭调度
        saved = await (await fetch(`${base}/api/schedule`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: false, mode: 'daily', time: '07:00' })
        })).json()
        assert.equal(saved.enabled, false)
        assert.equal(saved.nextRun, null)
        const microsoftPassword = 'MICROSOFT_PASSWORD_MUST_NOT_LEAK'
        assert.equal((await fetch(`${base}/api/accounts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'user@example.com', password: microsoftPassword, geoLocale: 'auto', langCode: 'zh' })
        })).status, 201)
        const stateText = await (await fetch(`${base}/api/state`)).text()
        assert.equal(stateText.includes(microsoftPassword), false)
        assert.equal(JSON.parse(stateText).accounts[0].email, 'user@example.com')
        assert.equal((await fetch(`${base}/api/accounts/${encodeURIComponent('user@example.com')}`, { method: 'DELETE' })).status, 200)
        assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'dist/config/accounts.json'), 'utf8')).length, 0)
        assert.equal((await fetch(`${base}/api/bootstrap`)).status, 404)
        console.log('Web UI E2E: PASS')
    } finally {
        child.kill()
        fs.rmSync(root, { recursive: true, force: true })
    }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
