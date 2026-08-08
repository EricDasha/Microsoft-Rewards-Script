const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { spawn } = require('node:child_process')

const port = Number(process.env.WEB_PORT || 8080)
const appRoot = process.env.APP_ROOT || '/usr/src/microsoft-rewards-script'
const accountsFile = path.join(appRoot, 'dist/config/accounts.json')
const publicDir = process.env.PUBLIC_DIR || '/opt/rewards-web/public'
const lockFile = process.env.LOCK_FILE || '/tmp/run_daily.lock'
const logFile = process.env.LOG_FILE || '/var/log/microsoft-rewards.log'
const sessionsDir = path.join(appRoot, 'dist/browser/sessions')

function json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(value))
}

function body(req) {
    return new Promise((resolve, reject) => {
        const chunks = []
        let length = 0
        req.on('data', chunk => {
            length += chunk.length
            if (length > 65536) return reject(new Error('请求过大'))
            chunks.push(chunk)
        })
        req.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
            catch { reject(new Error('JSON 无效')) }
        })
        req.on('error', reject)
    })
}

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
    catch { return fallback }
}

function atomicWrite(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    const temporary = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temporary, file)
    fs.chmodSync(file, 0o600)
}

function running() {
    try {
        const pid = Number(fs.readFileSync(lockFile, 'utf8'))
        process.kill(pid, 0)
        return true
    } catch { return false }
}

function stopRunner() {
    let pid
    try { pid = Number(fs.readFileSync(lockFile, 'utf8')) } catch { return false }
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
        process.kill(-pid, 'SIGTERM')
    } catch {
        try { process.kill(pid, 'SIGTERM') } catch { return false }
    }
    return true
}

function accounts() {
    const value = readJson(accountsFile, [])
    return Array.isArray(value) ? value : []
}

function maskedAccounts() {
    return accounts().map(account => ({
        email: account.email,
        geoLocale: account.geoLocale,
        langCode: account.langCode,
        hasPassword: Boolean(account.password),
        hasTotp: Boolean(account.totpSecret),
        desktopSession: fs.existsSync(path.join(sessionsDir, String(account.email), 'session_desktop.json')),
        mobileSession: fs.existsSync(path.join(sessionsDir, String(account.email), 'session_mobile.json'))
    }))
}

function accountFrom(input) {
    const email = typeof input.email === 'string' ? input.email.trim() : ''
    const password = typeof input.password === 'string' ? input.password : ''
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Microsoft 邮箱无效')
    if (!password || password.length > 512) throw new Error('Microsoft 密码不能为空且不能超过 512 位')
    return {
        email,
        password,
        totpSecret: typeof input.totpSecret === 'string' ? input.totpSecret.trim() : '',
        recoveryEmail: typeof input.recoveryEmail === 'string' ? input.recoveryEmail.trim() : '',
        geoLocale: typeof input.geoLocale === 'string' && input.geoLocale.trim() ? input.geoLocale.trim() : 'auto',
        langCode: typeof input.langCode === 'string' && input.langCode.trim() ? input.langCode.trim() : 'zh',
        proxy: { proxyAxios: false, url: '', port: 0, username: '', password: '' },
        saveFingerprint: { mobile: true, desktop: true }
    }
}

function tailLog() {
    try { return fs.readFileSync(logFile, 'utf8').slice(-50000) }
    catch { return '' }
}

async function api(req, res, pathname) {
    if (pathname === '/api/state' && req.method === 'GET') return json(res, 200, { running: running(), accounts: maskedAccounts(), log: tailLog() })
    if (pathname === '/api/accounts' && req.method === 'POST') {
        let account
        try { account = accountFrom(await body(req)) } catch (error) { return json(res, 400, { error: error.message }) }
        const next = accounts().filter(item => item.email !== account.email)
        next.push(account)
        atomicWrite(accountsFile, next)
        return json(res, 201, { ok: true })
    }
    const match = pathname.match(/^\/api\/accounts\/(.+)$/)
    if (match && req.method === 'DELETE') {
        const email = decodeURIComponent(match[1])
        const current = accounts()
        const next = current.filter(item => item.email !== email)
        if (next.length === current.length) return json(res, 404, { error: '账号不存在' })
        atomicWrite(accountsFile, next)
        return json(res, 200, { ok: true })
    }
    if (pathname === '/api/run' && req.method === 'POST') {
        if (running()) return json(res, 409, { error: '任务已经在运行' })
        const child = spawn('bash', [process.env.RUN_SCRIPT || path.join(appRoot, 'scripts/docker/run_daily.sh')], {
            cwd: appRoot,
            detached: true,
            stdio: 'ignore',
            env: { ...process.env, SKIP_RANDOM_SLEEP: 'true' }
        })
        child.unref()
        return json(res, 202, { ok: true })
    }
    if (pathname === '/api/stop' && req.method === 'POST') {
        return stopRunner() ? json(res, 202, { ok: true }) : json(res, 409, { error: '当前没有运行中的任务' })
    }
    return json(res, 404, { error: '接口不存在' })
}

function staticFile(res, pathname) {
    const file = pathname === '/' ? path.join(publicDir, 'index.html') : path.resolve(publicDir, pathname.replace(/^\/+/, ''))
    if (!file.startsWith(`${publicDir}${path.sep}`) && file !== path.join(publicDir, 'index.html')) return json(res, 403, { error: '禁止访问' })
    const target = fs.existsSync(file) ? file : path.join(publicDir, 'index.html')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
    fs.createReadStream(target).pipe(res)
}

http.createServer((req, res) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname
    if (pathname === '/health') return json(res, 200, { ok: true })
    if (pathname.startsWith('/api/')) return api(req, res, pathname).catch(() => json(res, 500, { error: '服务器内部错误' }))
    staticFile(res, pathname)
}).listen(port, '0.0.0.0', () => console.log(`[web-ui] listening on ${port}`))
