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
        assert.deepEqual(await (await fetch(`${base}/api/state`)).json(), { running: false, accounts: [], log: '' })
        assert.equal((await fetch(`${base}/api/stop`, { method: 'POST' })).status, 409)
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
