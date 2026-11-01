const canvas = document.getElementById("canvas")
const ctx = canvas.getContext("2d")
const score = document.getElementById("score")
const overlay = document.getElementById("overlay")
const overlayTitle = document.getElementById("overlay-title")
const overlayText = document.getElementById("overlay-text")
const playButton = document.getElementById("play")

const TAU = Math.PI * 2
const R = 1800 // arena radius
const FOOD_COUNT = 700
const BOT_COUNT = 14
const NAMES = ["Viper", "Mamba", "Cobra", "Python", "Adder", "Asp", "Boa", "Taipan", "Krait", "Rattler", "Sidewinder", "Anaconda", "Copperhead", "Fang"]

var VW, VH, dpr
var snakes = [], food = [], ranked = []
var player = null
var mx = innerWidth / 2, my = innerHeight / 2
var boosting = false
var cam = { x: 0, y: 0, zoom: 0.5 }
var last = performance.now()

const rnd = (a, b) => a + Math.random() * (b - a)

function resize() {
    dpr = window.devicePixelRatio || 1
    VW = window.innerWidth
    VH = window.innerHeight
    canvas.width = VW * dpr
    canvas.height = VH * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}
window.addEventListener("resize", resize)
resize()

function random_point(frac) {
    const a = rnd(0, TAU), d = Math.sqrt(Math.random()) * R * frac
    return { x: Math.cos(a) * d, y: Math.sin(a) * d }
}

function make_snake(x, y, hue, name, isBot, len) {
    const a = rnd(0, TAU)
    const s = { name, hue, isBot, len, angle: a, target: a, segs: [], dead: false,
                boost: false, fast: false, drop: 0, think: 0, wander: 0, respawn: 0 }
    for (let i = 0; i < Math.floor(len); i++) {
        s.segs.push({ x: x - Math.cos(a) * i * 8, y: y - Math.sin(a) * i * 8 })
    }
    return s
}

const radius = (s) => 8 + Math.sqrt(s.len) * 0.9
const score_of = (s) => Math.max(0, Math.floor((s.len - 10) * 10))

function add_food(x, y, v, hue) {
    food.push({ x, y, v, r: 3 + Math.min(6, v * 4), h: hue, p: rnd(0, TAU) })
}

function spawn_food() {
    const p = random_point(0.97)
    add_food(p.x, p.y, rnd(0.3, 0.8), rnd(0, 360))
}

// ---------- simulation ----------

function step(s, dt) {
    const r = radius(s), sp = r * 0.6
    let d = s.target - s.angle
    d = Math.atan2(Math.sin(d), Math.cos(d))
    const maxTurn = Math.max(0.03, 0.12 - r * 0.002) * dt
    s.angle += Math.max(-maxTurn, Math.min(maxTurn, d))

    s.fast = s.boost && s.len > 12
    const speed = (s.fast ? 6 : 3.2) * dt
    const head = s.segs[0]
    head.x += Math.cos(s.angle) * speed
    head.y += Math.sin(s.angle) * speed

    for (let i = 1; i < s.segs.length; i++) {
        const prev = s.segs[i - 1], cur = s.segs[i]
        const dx = prev.x - cur.x, dy = prev.y - cur.y
        const dist = Math.hypot(dx, dy)
        if (dist > sp) {
            cur.x = prev.x - (dx / dist) * sp
            cur.y = prev.y - (dy / dist) * sp
        }
    }

    // boosting burns length and leaves orbs behind
    if (s.fast) {
        s.len -= 0.04 * dt
        s.drop += 0.04 * dt
        if (s.drop >= 0.3) {
            s.drop -= 0.3
            const t = s.segs[s.segs.length - 1]
            add_food(t.x, t.y, 0.3, s.hue)
        }
    }
    const n = Math.floor(s.len)
    while (s.segs.length < n) s.segs.push({ ...s.segs[s.segs.length - 1] })
    while (s.segs.length > n && s.segs.length > 3) s.segs.pop()
}

function eat(s) {
    const h = s.segs[0], r = radius(s)
    const mag = (r + 34) ** 2, bite = (r + 4) ** 2
    for (let i = food.length - 1; i >= 0; i--) {
        const f = food[i]
        const dx = h.x - f.x, dy = h.y - f.y
        const d2 = dx * dx + dy * dy
        if (d2 > mag) continue
        if (d2 < bite) {
            s.len += f.v
            food[i] = food[food.length - 1]
            food.pop()
        } else {
            f.x += dx * 0.18
            f.y += dy * 0.18
        }
    }
}

function think(s) {
    const h = s.segs[0]
    const cos = Math.cos(s.angle), sin = Math.sin(s.angle)
    if (Math.hypot(h.x, h.y) > R - 260) { s.target = Math.atan2(-h.y, -h.x); return }

    for (const o of snakes) {
        if (o === s || o.dead) continue
        for (let i = 0; i < o.segs.length; i += 2) {
            const p = o.segs[i], dx = p.x - h.x, dy = p.y - h.y
            if (dx * dx + dy * dy < 140 * 140 && dx * cos + dy * sin > 0) {
                s.target = s.angle + (cos * dy - sin * dx > 0 ? -1.2 : 1.2)
                return
            }
        }
    }

    let best = null, bd = 380 * 380
    for (const f of food) {
        const dx = f.x - h.x, dy = f.y - h.y, d2 = dx * dx + dy * dy
        if (d2 < bd) { bd = d2; best = f }
    }
    if (best) { s.target = Math.atan2(best.y - h.y, best.x - h.x); return }
    if (--s.wander <= 0) { s.target += rnd(-0.8, 0.8); s.wander = 6 + Math.random() * 10 }
}

function die(s, why) {
    s.dead = true
    const per = (s.len * 0.6) / Math.ceil(s.segs.length / 2)
    for (let i = 0; i < s.segs.length; i += 2) {
        const p = s.segs[i]
        add_food(p.x + rnd(-6, 6), p.y + rnd(-6, 6), per, s.hue)
    }
    if (s.isBot) {
        s.respawn = 180
    } else {
        player = null
        show_overlay("Game over", `You ${why}. Final score: ${score_of(s)}.`, "Play again")
    }
}

function collide() {
    for (const a of snakes) {
        if (a.dead) continue
        const h = a.segs[0], ra = radius(a)
        if (Math.hypot(h.x, h.y) + ra > R) { die(a, "hit the wall"); continue }

        for (const b of snakes) {
            if (b === a || b.dead) continue
            const rb = radius(b), lim = (ra + rb) * 0.7, lim2 = lim * lim
            const reach = b.segs.length * rb * 0.6 + lim + 30
            const bh = b.segs[0]
            if (Math.abs(h.x - bh.x) > reach || Math.abs(h.y - bh.y) > reach) continue
            let hit = false
            for (let i = 0; i < b.segs.length; i++) {
                const dx = h.x - b.segs[i].x, dy = h.y - b.segs[i].y
                if (dx * dx + dy * dy < lim2) { hit = true; break }
            }
            if (hit) { die(a, `ran into ${b.name}`); break }
        }
    }
}

function update(dt) {
    if (player) {
        player.target = Math.atan2(my - VH / 2, mx - VW / 2)
        player.boost = boosting
    }
    for (const s of snakes) {
        if (s.dead) {
            if (s.isBot && (s.respawn -= dt) <= 0) {
                const p = random_point(0.8)
                Object.assign(s, make_snake(p.x, p.y, s.hue, s.name, true, rnd(10, 25)))
            }
            continue
        }
        if (s.isBot && (s.think -= dt) <= 0) { think(s); s.think = 5 }
        step(s, dt)
        eat(s)
    }
    collide()
    for (let n = 0; food.length < FOOD_COUNT && n < 6; n++) spawn_food()

    ranked = snakes.filter((s) => !s.dead).sort((a, b) => b.len - a.len)
    const focus = player || ranked[0]
    if (focus) {
        const h = focus.segs[0]
        cam.x += (h.x - cam.x) * 0.15 * dt
        cam.y += (h.y - cam.y) * 0.15 * dt
        const zt = player ? Math.max(0.5, 1.15 - Math.sqrt(player.len) * 0.03) : 0.6
        cam.zoom += (zt - cam.zoom) * 0.05 * dt
    }
    if (player) score.textContent = score_of(player)
}

// ---------- rendering ----------

function skin(s, i, n) {
    const stripe = (i >> 2) % 2
    if (!s.isBot) {
        const t = i / Math.max(n - 1, 1)
        const hue = ((44 - 74 * t) % 360 + 360) % 360
        return `hsl(${hue}, 95%, ${stripe ? 56 : 63}%)`
    }
    return `hsl(${s.hue}, 80%, ${stripe ? 50 : 60}%)`
}

function draw_eyes(h, r, angle) {
    for (const side of [-1, 1]) {
        const a = angle + side * 0.75
        const ex = h.x + Math.cos(a) * r * 0.55, ey = h.y + Math.sin(a) * r * 0.55
        ctx.beginPath(); ctx.arc(ex, ey, r * 0.32, 0, TAU); ctx.fillStyle = "#fff"; ctx.fill()
        ctx.beginPath()
        ctx.arc(ex + Math.cos(angle) * r * 0.1, ey + Math.sin(angle) * r * 0.1, r * 0.16, 0, TAU)
        ctx.fillStyle = "#10222b"; ctx.fill()
    }
}

function draw_snake(s, hw, hh) {
    const r = radius(s), n = s.segs.length
    for (let i = n - 1; i >= 0; i--) {
        const p = s.segs[i]
        if (Math.abs(p.x - cam.x) > hw || Math.abs(p.y - cam.y) > hh) continue
        const rr = i === 0 ? r * 1.08 : r * (1 - 0.25 * i / n)
        ctx.fillStyle = skin(s, i, n)
        if (s.fast && i % 3 === 0) {
            ctx.globalAlpha = 0.18
            ctx.beginPath(); ctx.arc(p.x, p.y, rr * 1.7, 0, TAU); ctx.fill()
            ctx.globalAlpha = 1
        }
        ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, TAU); ctx.fill()
    }
    const h = s.segs[0]
    draw_eyes(h, r, s.angle)
    if (s.isBot) {
        ctx.fillStyle = "rgba(232,246,245,0.7)"
        ctx.font = '600 13px "DM Sans", sans-serif'
        ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"
        ctx.fillText(s.name, h.x, h.y - r - 10)
    }
}

function draw_hud() {
    const x = VW - 200, top = ranked.slice(0, 6)
    ctx.fillStyle = "rgba(7,19,27,0.6)"
    ctx.fillRect(x - 12, 12, 196, 36 + top.length * 20)
    ctx.font = '600 13px "DM Sans", sans-serif'
    ctx.textBaseline = "top"
    ctx.textAlign = "left"; ctx.fillStyle = "#8fb3b8"; ctx.fillText("Leaderboard", x, 20)
    top.forEach((s, i) => {
        const y = 44 + i * 20
        ctx.fillStyle = s === player ? "#ffc857" : "#e8f6f5"
        ctx.textAlign = "left"; ctx.fillText(`${i + 1}. ${s.name}`, x, y)
        ctx.textAlign = "right"; ctx.fillText(score_of(s), x + 176, y)
    })

    const cx = VW - 76, cy = VH - 76, mr = 56
    ctx.beginPath(); ctx.arc(cx, cy, mr, 0, TAU)
    ctx.fillStyle = "rgba(7,19,27,0.6)"; ctx.fill()
    ctx.strokeStyle = "rgba(46,196,182,0.6)"; ctx.lineWidth = 2; ctx.stroke()
    for (const s of ranked) {
        const h = s.segs[0]
        ctx.beginPath()
        ctx.arc(cx + h.x / R * mr, cy + h.y / R * mr, s === player ? 3.5 : 2, 0, TAU)
        ctx.fillStyle = s === player ? "#ffc857" : `hsl(${s.hue}, 80%, 60%)`
        ctx.fill()
    }
}

function draw(now) {
    ctx.fillStyle = "#050d12"
    ctx.fillRect(0, 0, VW, VH)
    const hw = VW / 2 / cam.zoom + 60, hh = VH / 2 / cam.zoom + 60

    ctx.save()
    ctx.translate(VW / 2, VH / 2)
    ctx.scale(cam.zoom, cam.zoom)
    ctx.translate(-cam.x, -cam.y)

    // arena floor and grid
    ctx.save()
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU)
    ctx.fillStyle = "#0b1f2a"; ctx.fill(); ctx.clip()
    ctx.strokeStyle = "rgba(120,220,232,0.07)"; ctx.lineWidth = 1
    ctx.beginPath()
    const G = 90
    for (let x = Math.floor((cam.x - hw) / G) * G; x < cam.x + hw; x += G) {
        ctx.moveTo(x, cam.y - hh); ctx.lineTo(x, cam.y + hh)
    }
    for (let y = Math.floor((cam.y - hh) / G) * G; y < cam.y + hh; y += G) {
        ctx.moveTo(cam.x - hw, y); ctx.lineTo(cam.x + hw, y)
    }
    ctx.stroke()
    ctx.restore()

    // glowing wall, turns red as the player nears it
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU)
    ctx.lineWidth = 16; ctx.strokeStyle = "#2ec4b6"
    ctx.shadowColor = "#2ec4b6"; ctx.shadowBlur = 30
    ctx.stroke(); ctx.shadowBlur = 0
    if (player) {
        const h = player.segs[0]
        const danger = Math.max(0, (Math.hypot(h.x, h.y) - (R - 250)) / 250)
        if (danger > 0) {
            ctx.strokeStyle = `rgba(255, 93, 115, ${Math.min(1, danger)})`
            ctx.lineWidth = 30
            ctx.stroke()
        }
    }

    // food orbs
    for (const f of food) {
        if (Math.abs(f.x - cam.x) > hw || Math.abs(f.y - cam.y) > hh) continue
        const pulse = 1 + 0.15 * Math.sin(now * 0.005 + f.p)
        ctx.fillStyle = `hsl(${f.h}, 90%, 60%)`
        ctx.globalAlpha = 0.22
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 2.2 * pulse, 0, TAU); ctx.fill()
        ctx.globalAlpha = 1
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * pulse, 0, TAU); ctx.fill()
    }

    for (const s of snakes) if (!s.dead) draw_snake(s, hw, hh)
    ctx.restore()

    draw_hud()
}

// ---------- flow and input ----------

function show_overlay(title, text, buttonLabel) {
    overlayTitle.textContent = title
    overlayText.textContent = text
    playButton.textContent = buttonLabel
    overlay.classList.remove("hidden")
    playButton.focus()
}

function start_game() {
    if (player) return
    snakes = snakes.filter((s) => s.isBot)
    const p = random_point(0.5)
    player = make_snake(p.x, p.y, 44, "You", false, 10)
    snakes.push(player)
    cam.x = p.x; cam.y = p.y
    boosting = false
    score.textContent = "0"
    overlay.classList.add("hidden")
}

playButton.addEventListener("click", start_game)
window.addEventListener("pointermove", (e) => { mx = e.clientX; my = e.clientY })
window.addEventListener("pointerdown", (e) => { mx = e.clientX; my = e.clientY; boosting = true })
window.addEventListener("pointerup", () => { boosting = false })
window.addEventListener("pointercancel", () => { boosting = false })
window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !overlay.contains(document.activeElement)) { boosting = true; e.preventDefault() }
})
window.addEventListener("keyup", (e) => { if (e.code === "Space") boosting = false })

for (let i = 0; i < BOT_COUNT; i++) {
    const p = random_point(0.85)
    snakes.push(make_snake(p.x, p.y, (i * 360 / BOT_COUNT + 200) % 360, NAMES[i % NAMES.length], true, rnd(10, 40)))
}
for (let i = 0; i < FOOD_COUNT; i++) spawn_food()

function frame(now) {
    const dt = Math.min(2.5, (now - last) / 16.667)
    last = now
    update(dt)
    draw(now)
    requestAnimationFrame(frame)
}
requestAnimationFrame(frame)