const WEBM_MIME_TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm"
]

export function selectWebmMimeType(MediaRecorderConstructor = globalThis.MediaRecorder) {
  if (!MediaRecorderConstructor) return ""
  if (typeof MediaRecorderConstructor.isTypeSupported !== "function") return "video/webm"
  return WEBM_MIME_TYPES.find(type => MediaRecorderConstructor.isTypeSupported(type)) || ""
}

export function getSopVideoRendererSupport(runtime = globalThis) {
  var canvas = runtime.document && runtime.document.createElement("canvas")
  var mimeType = selectWebmMimeType(runtime.MediaRecorder)
  if (!runtime.MediaRecorder || !canvas || typeof canvas.captureStream !== "function" || !mimeType) {
    return { supported: false, reason: '当前浏览器不支持在本地生成 WebM 视频' }
  }
  return { supported: true, mimeType: mimeType }
}

function makeAbortError() {
  var error = new Error('已取消视频生成')
  error.name = 'AbortError'
  return error
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }

function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2 }

function asText(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function sceneAtTime(scenes, elapsedSeconds) {
  var sceneIndex = scenes.findIndex(scene => elapsedSeconds < Number(scene.endTime))
  var index = sceneIndex >= 0 ? sceneIndex : scenes.length - 1
  var scene = scenes[index]
  var duration = Math.max(0.1, Number(scene.durationSeconds) || Number(scene.endTime) - Number(scene.startTime) || 1)
  var localProgress = clamp((elapsedSeconds - (Number(scene.startTime) || 0)) / duration, 0, 1)
  return { scene: scene, index: index, localProgress: localProgress }
}

function roundedRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function wrapText(ctx, text, maxWidth, maxLines) {
  if (maxLines === undefined) maxLines = 4
  var chars = Array.from(asText(text))
  if (!chars.length) return []
  var lines = [], line = ''
  for (var i = 0; i < chars.length; i++) {
    var candidate = line + chars[i]
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line); line = chars[i]
      if (lines.length >= maxLines) break
    } else { line = candidate }
  }
  if (line && lines.length < maxLines) lines.push(line)
  if (lines.length === maxLines && chars.join('').length > lines.join('').length) {
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '...'
  }
  return lines
}

function drawTextLines(ctx, lines, x, y, lh) {
  lines.forEach(function(line, i) { ctx.fillText(line, x, y + i * lh) })
}

var F = '"Microsoft YaHei","PingFang SC","Hiragino Sans GB",sans-serif'
var BRAND_BLUE = '#0a7cdc'


function drawDesktopBackground(ctx, w, h, t) {
  var g = ctx.createRadialGradient(w * 0.5, h * 0.35, 0, w * 0.5, h * 0.35, w * 0.7)
  g.addColorStop(0, '#1a2332')
  g.addColorStop(0.5, '#121821')
  g.addColorStop(1, '#080c12')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  ctx.save()
  ctx.globalAlpha = 0.03
  for (var i = 0; i < 60; i++) {
    var px = (i * 137.5 + t * 8) % w
    var py = (i * 89.3) % h
    var pr = 1 + (i % 3)
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(px, py, pr, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
  var vg = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.7)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.5)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, w, h)
}

function drawTranslatorDevice(ctx, x, y, w, h, tilt) {
  ctx.save()
  ctx.translate(x + w / 2, y + h / 2)
  ctx.rotate(tilt)
  ctx.translate(-(x + w / 2), -(y + h / 2))
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 35
  ctx.shadowOffsetX = 10
  ctx.shadowOffsetY = 15
  var bg = ctx.createLinearGradient(x, y, x + w, y + h)
  bg.addColorStop(0, '#33333a')
  bg.addColorStop(0.3, '#252529')
  bg.addColorStop(0.7, '#1c1c20')
  bg.addColorStop(1, '#131316')
  roundedRect(ctx, x, y, w, h, 32)
  ctx.fillStyle = bg
  ctx.fill()
  ctx.restore()
  ctx.save()
  ctx.translate(x + w / 2, y + h / 2)
  ctx.rotate(tilt)
  ctx.translate(-(x + w / 2), -(y + h / 2))
  ctx.strokeStyle = 'rgba(255,255,255,0.1)'
  ctx.lineWidth = 2
  roundedRect(ctx, x + 3, y + 3, w - 6, h - 6, 29)
  ctx.stroke()
  var hl = ctx.createLinearGradient(x, y, x + w, y)
  hl.addColorStop(0, 'rgba(255,255,255,0)')
  hl.addColorStop(0.3, 'rgba(255,255,255,0.06)')
  hl.addColorStop(0.5, 'rgba(255,255,255,0.12)')
  hl.addColorStop(0.7, 'rgba(255,255,255,0.06)')
  hl.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = hl
  roundedRect(ctx, x + 6, y + 6, w - 12, 20, 24)
  ctx.fill()
  ctx.fillStyle = 'rgba(0,0,0,0.7)'
  for (var i = 0; i < 9; i++) {
    ctx.beginPath()
    ctx.arc(x + w / 2 - 48 + i * 12, y + h - 26, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.beginPath()
  ctx.arc(x + w / 2, y + 16, 3, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(x + w / 2, y + 16, 7, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function drawScreenFrame(ctx, x, y, w, h, scene, localProgress, elapsedSeconds) {
  ctx.save()
  ctx.fillStyle = '#000'
  roundedRect(ctx, x, y, w, h, 10)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.save()
  roundedRect(ctx, x + 3, y + 3, w - 6, h - 6, 8)
  ctx.clip()
  var bg = ctx.createLinearGradient(x, y, x, y + h)
  bg.addColorStop(0, '#0a1525')
  bg.addColorStop(1, '#060d18')
  ctx.fillStyle = bg
  ctx.fillRect(x + 3, y + 3, w - 6, h - 6)
  var fade = clamp(localProgress * 2.5, 0, 1)
  ctx.globalAlpha = fade
  if (scene.kind === 'intro') drawHomeUI(ctx, x + 3, y + 3, w - 6, h - 6)
  else if (scene.kind === 'preparation') drawPrepUI(ctx, x + 3, y + 3, w - 6, h - 6, scene)
  else if (scene.kind === 'step') drawStepUI(ctx, x + 3, y + 3, w - 6, h - 6, scene, localProgress, elapsedSeconds)
  else if (scene.kind === 'completion') drawDoneUI(ctx, x + 3, y + 3, w - 6, h - 6)
  ctx.globalAlpha = 1
  ctx.restore()
  ctx.restore()
}

function drawStatusBar(ctx, x, y, w) {
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.font = '400 12px ' + F
  ctx.textAlign = 'left'
  ctx.fillText('9:41', x + 10, y + 16)
  ctx.textAlign = 'right'
  ctx.fillText('📶 100%', x + w - 10, y + 16)
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  ctx.fillRect(x, y + 24, w, 1)
}

function drawHomeUI(ctx, x, y, w, _h) {
  drawStatusBar(ctx, x, y, w)
  var cx = x + w / 2
  ctx.fillStyle = '#ffffff'
  ctx.font = '700 20px ' + F
  ctx.textAlign = 'center'
  ctx.fillText('讯飞翻译机', cx, y + 56)
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.font = '400 13px ' + F
  ctx.fillText('智能翻译 · 即时互译', cx, y + 76)
  var icons = [
    { label: '语音翻译', color: BRAND_BLUE, icon: '🎤' },
    { label: '拍照翻译', color: '#10b981', icon: '📷' },
    { label: '文本翻译', color: '#f59e0b', icon: '📝' },
    { label: '对话翻译', color: '#8b5cf6', icon: '💬' }
  ]
  var cw = w * 0.42, ch = 64, gx = 12, gy = 12
  var gw = 2 * cw + gx
  var sx = cx - gw / 2, sy = y + 96
  icons.forEach(function(ic, i) {
    var col = i % 2, row = Math.floor(i / 2)
    var ix = sx + col * (cw + gx), iy = sy + row * (ch + gy)
    roundedRect(ctx, ix, iy, cw, ch, 12)
    ctx.fillStyle = ic.color + '1a'
    ctx.fill()
    ctx.strokeStyle = ic.color + '44'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = ic.color
    ctx.font = '700 26px ' + F
    ctx.textAlign = 'center'
    ctx.fillText(ic.icon, ix + 26, iy + ch / 2 + 9)
    ctx.fillStyle = '#fff'
    ctx.font = '600 15px ' + F
    ctx.textAlign = 'left'
    ctx.fillText(ic.label, ix + 52, iy + ch / 2 + 5)
  })
}

function drawPrepUI(ctx, x, y, w, h, scene) {
  drawStatusBar(ctx, x, y, w)
  var cx = x + w / 2
  ctx.fillStyle = '#fbbf24'
  ctx.font = '700 20px ' + F
  ctx.textAlign = 'center'
  ctx.fillText('⚠ 开始前确认', cx, y + 50)
  var checks = (scene.notes || []).slice(0, 4)
  if (checks.length === 0) checks = ['翻译机已开机', '语言已设置', '网络已连接']
  checks.forEach(function(c, i) {
    var cy = y + 80 + i * 38
    if (cy + 30 > y + h - 10) return
    ctx.fillStyle = 'rgba(251,191,36,0.08)'
    roundedRect(ctx, x + 14, cy - 12, w - 28, 30, 8)
    ctx.fill()
    ctx.strokeStyle = '#fbbf24'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x + 30, cy + 3, 7, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    ctx.font = '400 14px ' + F
    ctx.textAlign = 'left'
    var t = wrapText(ctx, c, w - 80, 1)[0] || c
    ctx.fillText(t, x + 46, cy + 8)
  })
}

function drawStepUI(ctx, x, y, w, h, scene, lp, elapsed) {
  drawStatusBar(ctx, x, y, w)
  var cx = x + w / 2
  var sn = Number(scene.stepNumber) || 1
  if (sn <= 1) {
    drawHomeUI(ctx, x, y, w, h)
    return
  }
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  roundedRect(ctx, x + 12, y + 34, w - 24, 40, 10)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.font = '700 17px ' + F
  ctx.textAlign = 'left'
  ctx.fillText('中文', x + 30, y + 60)
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.font = '400 16px ' + F
  ctx.textAlign = 'center'
  ctx.fillText('⇄', cx, y + 60)
  ctx.fillStyle = '#fff'
  ctx.font = '700 17px ' + F
  ctx.textAlign = 'right'
  ctx.fillText('English', x + w - 30, y + 60)
  var ry = y + 88, rh = h - 88 - 80
  ctx.fillStyle = 'rgba(255,255,255,0.03)'
  roundedRect(ctx, x + 12, ry, w - 24, rh, 10)
  ctx.fill()
  if (sn === 2) {
    ctx.fillStyle = '#fff'
    ctx.font = '700 16px ' + F
    ctx.textAlign = 'center'
    ctx.fillText('选择目标语言', cx, ry + 28)
    var langs = ['English', '日本語', '한국어', 'Français']
    langs.forEach(function(lg, i) {
      var ly = ry + 48 + i * 36
      if (ly + 28 > ry + rh - 8) return
      if (i === 0) {
        ctx.fillStyle = 'rgba(10,124,220,0.15)'
        roundedRect(ctx, x + 20, ly - 10, w - 40, 28, 8)
        ctx.fill()
      }
      ctx.fillStyle = i === 0 ? BRAND_BLUE : 'rgba(255,255,255,0.5)'
      ctx.font = '600 15px ' + F
      ctx.textAlign = 'left'
      ctx.fillText(lg, x + 32, ly + 8)
      if (i === 0) {
        ctx.fillStyle = BRAND_BLUE
        ctx.textAlign = 'right'
        ctx.fillText('✓', x + w - 32, ly + 8)
      }
    })
  } else {
    if (lp > 0.25) {
      var charCount = Math.floor(clamp((lp - 0.25) / 0.35, 0, 1) * 12)
      var src = '你好，请问车站怎么走？'
      ctx.fillStyle = 'rgba(255,255,255,0.65)'
      ctx.font = '400 15px ' + F
      ctx.textAlign = 'left'
      ctx.fillText(src.slice(0, charCount), x + 24, ry + 30)
      if (lp > 0.6) {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x + 24, ry + 44)
        ctx.lineTo(x + w - 24, ry + 44)
        ctx.stroke()
        var transChars = Math.floor(clamp((lp - 0.6) / 0.3, 0, 1) * 30)
        var trans = 'Hello, how can I get to the station?'
        ctx.fillStyle = '#60a5fa'
        ctx.font = '700 17px ' + F
        ctx.fillText(trans.slice(0, transChars), x + 24, ry + 70)
      }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.25)'
      ctx.font = '400 14px ' + F
      ctx.textAlign = 'center'
      ctx.fillText('按住麦克风说话', cx, ry + rh / 2)
    }
  }
  var micR = 30, micCX = cx, micCY = y + h - 46
  var isRecording = sn >= 3 && lp > 0.1 && lp < 0.5
  var pulse = isRecording ? Math.abs(Math.sin(elapsed * 8)) * 6 : 0
  if (isRecording) {
    ctx.fillStyle = 'rgba(239,68,68,0.2)'
    ctx.beginPath()
    ctx.arc(micCX, micCY, micR + 12 + pulse, 0, Math.PI * 2)
    ctx.fill()
  }
  var micGrad = ctx.createRadialGradient(micCX - 8, micCY - 8, 0, micCX, micCY, micR)
  if (isRecording) {
    micGrad.addColorStop(0, '#ef4444')
    micGrad.addColorStop(1, '#dc2626')
  } else {
    micGrad.addColorStop(0, BRAND_BLUE)
    micGrad.addColorStop(1, '#0858a8')
  }
  ctx.fillStyle = micGrad
  ctx.beginPath()
  ctx.arc(micCX, micCY, micR + pulse, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.font = '700 22px ' + F
  ctx.textAlign = 'center'
  ctx.fillText('🎤', micCX, micCY + 8)
  if (isRecording) {
    ctx.fillStyle = '#ef4444'
    ctx.font = '700 12px ' + F
    ctx.fillText('正在听...', micCX, micCY + micR + 20)
    for (var wi = 0; wi < 5; wi++) {
      var wx = micCX - 40 + wi * 20
      var wh = 4 + Math.abs(Math.sin(elapsed * 10 + wi * 1.5)) * 12
      ctx.fillStyle = 'rgba(239,68,68,0.6)'
      roundedRect(ctx, wx - 2, micCY - wh / 2, 4, wh, 2)
      ctx.fill()
    }
  }
}

function drawDoneUI(ctx, x, y, w, h) {
  drawStatusBar(ctx, x, y, w)
  var cx = x + w / 2, cy = y + h / 2
  ctx.fillStyle = '#34d399'
  ctx.font = '700 56px ' + F
  ctx.textAlign = 'center'
  ctx.fillText('✓', cx, cy - 8)
  ctx.fillStyle = '#fff'
  ctx.font = '700 20px ' + F
  ctx.fillText('翻译完成', cx, cy + 28)
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.font = '400 14px ' + F
  ctx.fillText('已输出目标语言语音', cx, cy + 52)
}

function drawPhysicalButton(ctx, cx, cy, r, label, pressed) {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 10
  ctx.shadowOffsetY = 4
  var g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r)
  if (pressed) { g.addColorStop(0, '#0858a8'); g.addColorStop(1, '#064084') }
  else { g.addColorStop(0, '#3a3a40'); g.addColorStop(1, '#222226') }
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = pressed ? '#fff' : 'rgba(255,255,255,0.35)'
  ctx.font = '700 13px ' + F
  ctx.textAlign = 'center'
  ctx.fillText(label, cx, cy + 5)
}

function drawFinger(ctx, x, y, pressed, elapsed) {
  ctx.save()
  var wobble = pressed ? Math.sin(elapsed * 12) * 1.5 : 0
  var fx = x + wobble, fy = y + wobble
  ctx.shadowColor = 'rgba(0,0,0,0.3)'
  ctx.shadowBlur = 12
  ctx.shadowOffsetY = 6
  var g = ctx.createLinearGradient(fx - 20, fy - 40, fx + 20, fy + 10)
  g.addColorStop(0, '#f0c090')
  g.addColorStop(0.5, '#e8b080')
  g.addColorStop(1, '#d0a070')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.ellipse(fx, fy, 14, 18, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(fx - 12, fy + 14)
  ctx.lineTo(fx - 22, fy + 50)
  ctx.lineTo(fx + 22, fy + 50)
  ctx.lineTo(fx + 12, fy + 14)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
  if (pressed) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.beginPath()
    ctx.arc(fx, fy, 22, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawPulseArrow(ctx, fx, fy, tx, ty, color, elapsed) {
  ctx.save()
  var pulse = 0.7 + Math.sin(elapsed * 4) * 0.3
  ctx.globalAlpha = pulse
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 3
  ctx.shadowColor = color
  ctx.shadowBlur = 10
  ctx.beginPath()
  ctx.moveTo(fx, fy)
  var mx = (fx + tx) / 2
  ctx.quadraticCurveTo(mx, fy, tx, ty)
  ctx.stroke()
  var ang = Math.atan2(ty - fy, tx - fx)
  var al = 16
  ctx.beginPath()
  ctx.moveTo(tx, ty)
  ctx.lineTo(tx - al * Math.cos(ang - 0.5), ty - al * Math.sin(ang - 0.5))
  ctx.lineTo(tx - al * Math.cos(ang + 0.5), ty - al * Math.sin(ang + 0.5))
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawStepCircle(ctx, cx, cy, r, num, accent) {
  ctx.save()
  ctx.shadowColor = accent
  ctx.shadowBlur = 16
  var g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r)
  g.addColorStop(0, accent)
  g.addColorStop(1, accent + '88')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  ctx.fillStyle = '#fff'
  ctx.font = '700 28px ' + F
  ctx.textAlign = 'center'
  ctx.fillText(String(num), cx, cy + 10)
}

function drawStepPanel(ctx, x, y, w, h, scene, lp, accent, _elapsed) {
  ctx.save()
  ctx.fillStyle = 'rgba(255,255,255,0.025)'
  roundedRect(ctx, x, y, w, h, 18)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 1
  ctx.stroke()
  var rise = (1 - ease(clamp(lp * 2, 0, 1))) * 20
  var cy = y - rise
  if (scene.kind === 'step' && scene.stepNumber) {
    drawStepCircle(ctx, x + 50, cy + 56, 28, scene.stepNumber, accent)
  } else {
    var icon = scene.kind === 'intro' ? '📋' : scene.kind === 'preparation' ? '⚠' : '✓'
    ctx.fillStyle = accent
    ctx.font = '700 36px ' + F
    ctx.textAlign = 'center'
    ctx.fillText(icon, x + 50, cy + 68)
  }
  var kindLabels = { intro: '操作概览', preparation: '开始前确认', step: '第 ' + (scene.stepNumber || '') + ' 步', completion: '完成确认' }
  ctx.fillStyle = accent
  ctx.font = '700 18px ' + F
  ctx.textAlign = 'left'
  ctx.fillText(kindLabels[scene.kind] || '操作指引', x + 92, cy + 44)
  ctx.fillStyle = 'rgba(255,255,255,0.1)'
  ctx.fillRect(x + 24, cy + 82, w - 48, 1)
  var titleText = scene.kind === 'step' ? (scene.body || scene.title || '') : (scene.title || '')
  ctx.fillStyle = '#fff'
  ctx.font = '700 26px ' + F
  ctx.textAlign = 'left'
  var titleLines = wrapText(ctx, titleText, w - 48, 3)
  drawTextLines(ctx, titleLines, x + 24, cy + 116, 38)
  var contentY = cy + 116 + titleLines.length * 38 + 16
  if (scene.kind === 'intro' && scene.body) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.font = '400 17px ' + F
    var bl = wrapText(ctx, scene.body, w - 48, 2)
    drawTextLines(ctx, bl, x + 24, contentY, 26)
    contentY += bl.length * 26 + 16
  }
  if (scene.kind === 'step' && lp < 0.9) {
    ctx.fillStyle = accent
    ctx.font = '700 16px ' + F
    ctx.textAlign = 'left'
    ctx.fillText('👉 请这样做', x + 24, contentY)
    contentY += 28
  }
  var noteY = contentY
  if (scene.notes && scene.notes.length > 0) {
    scene.notes.slice(0, 3).forEach(function(n, i) {
      var ny = noteY + i * 42
      if (ny + 36 > y + h - 20) return
      ctx.fillStyle = 'rgba(96,165,250,0.1)'
      roundedRect(ctx, x + 20, ny, w - 40, 32, 8)
      ctx.fill()
      ctx.fillStyle = '#60a5fa'
      ctx.font = '700 13px ' + F
      ctx.textAlign = 'left'
      ctx.fillText('提示', x + 34, ny + 21)
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.font = '400 14px ' + F
      ctx.fillText(wrapText(ctx, n, w - 110, 1)[0] || n, x + 72, ny + 21)
    })
    noteY += Math.min(scene.notes.length, 3) * 42
  }
  if (scene.warnings && scene.warnings.length > 0) {
    scene.warnings.slice(0, 2).forEach(function(wm, i) {
      var wy = noteY + i * 42
      if (wy + 36 > y + h - 20) return
      ctx.fillStyle = 'rgba(251,191,36,0.1)'
      roundedRect(ctx, x + 20, wy, w - 40, 32, 8)
      ctx.fill()
      ctx.fillStyle = '#fbbf24'
      ctx.font = '700 13px ' + F
      ctx.textAlign = 'left'
      ctx.fillText('注意', x + 34, wy + 21)
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.font = '400 14px ' + F
      ctx.fillText(wrapText(ctx, wm, w - 110, 1)[0] || wm, x + 72, wy + 21)
    })
  }
  ctx.restore()
}

function drawProgressBar(ctx, x, y, w, progress, accent) {
  roundedRect(ctx, x, y, w, 6, 3)
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  ctx.fill()
  var g = ctx.createLinearGradient(x, y, x + w, y)
  g.addColorStop(0, accent)
  g.addColorStop(1, accent + '88')
  ctx.fillStyle = g
  roundedRect(ctx, x, y, Math.max(8, w * progress), 6, 3)
  ctx.fill()
}

function drawBrandHeader(ctx, w, title) {
  ctx.fillStyle = BRAND_BLUE
  ctx.font = '700 24px ' + F
  ctx.textAlign = 'left'
  ctx.fillText('讯飞', 48, 48)
  ctx.fillStyle = '#fff'
  ctx.font = '600 24px ' + F
  ctx.fillText('翻译机', 48 + ctx.measureText('讯飞').width + 8, 48)
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.font = '400 16px ' + F
  ctx.textAlign = 'left'
  ctx.fillText('· 操作演示', 48 + ctx.measureText('讯飞翻译机').width + 16, 48)
  if (title) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.font = '400 16px ' + F
    ctx.textAlign = 'right'
    ctx.fillText(title, w - 48, 48)
  }
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  ctx.fillRect(48, 66, w - 96, 1)
}

function drawBrandFooter(ctx, w, h, elapsed, duration, scene) {
  drawProgressBar(ctx, 48, h - 48, w - 96, clamp(elapsed / duration, 0, 1), BRAND_BLUE)
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.font = '400 13px ' + F
  ctx.textAlign = 'left'
  ctx.fillText(Math.ceil(elapsed) + ' / ' + duration + ' 秒', 48, h - 58)
  var labels = { intro: '概览', preparation: '准备', step: '步骤 ' + (scene.stepNumber || ''), completion: '完成' }
  ctx.textAlign = 'right'
  ctx.fillText(labels[scene.kind] || '', w - 48, h - 58)
  ctx.fillStyle = 'rgba(10,124,220,0.4)'
  ctx.font = '700 12px ' + F
  ctx.textAlign = 'center'
  ctx.fillText('iFLYTEK', w / 2, h - 20)
}

function drawProductDemoFrame(ctx, width, height, storyboard, elapsedSeconds) {
  var scenes = storyboard.scenes
  var dur = Math.max(1, Number(storyboard.durationSeconds) || Number(scenes[scenes.length - 1].endTime) || 1)
  var a = sceneAtTime(scenes, elapsedSeconds)
  var scene = a.scene, lp = a.localProgress
  var accent = scene.kind === 'preparation' ? '#fbbf24' : scene.kind === 'completion' ? '#34d399' : BRAND_BLUE
  drawDesktopBackground(ctx, width, height, elapsedSeconds)
  drawBrandHeader(ctx, width, storyboard.title || '')
  var tilt = Math.sin(elapsedSeconds * 0.3) * 0.015
  var devW = 380, devH = 680
  var devX = 100, devY = 100
  drawTranslatorDevice(ctx, devX, devY, devW, devH, tilt)
  var sx = devX + 16, sy = devY + 36, sw = devW - 32, sh = devH - 36 - 80
  drawScreenFrame(ctx, sx, sy, sw, sh, scene, lp, elapsedSeconds)
  var btnCY = devY + devH - 42
  var btnPressed = scene.kind === 'step' && lp > 0.1 && lp < 0.4
  drawPhysicalButton(ctx, devX + devW / 2, btnCY, 22, '译', btnPressed)
  drawPhysicalButton(ctx, devX + devW / 2 - 60, btnCY, 16, '←', false)
  drawPhysicalButton(ctx, devX + devW / 2 + 60, btnCY, 16, '☰', false)
  var sn = Number(scene.stepNumber) || 0
  var showFinger = scene.kind === 'step' && lp > 0.15 && lp < 0.85
  if (showFinger) {
    var fingerX, fingerY
    if (sn <= 1) { fingerX = sx + sw * 0.3; fingerY = sy + 180 }
    else if (sn === 2) { fingerX = sx + sw * 0.7; fingerY = sy + 120 }
    else { fingerX = sx + sw / 2; fingerY = sy + sh - 50 }
    var pressed = lp > 0.2 && lp < 0.5
    drawFinger(ctx, fingerX, fingerY, pressed, elapsedSeconds)
  }
  if (scene.kind === 'step' && lp > 0.05 && lp < 0.95) {
    var arrowColor = accent
    var afx = devX + devW + 30, atx = devX + devW + 8
    var afy
    if (sn <= 2) afy = sy + 100
    else if (sn <= 5) afy = sy + sh - 50
    else afy = sy + 80
    drawPulseArrow(ctx, afx, afy, atx, afy, arrowColor, elapsedSeconds)
  }
  var panelX = devX + devW + 80, panelY = 90, panelW = width - panelX - 60, panelH = height - panelY - 100
  drawStepPanel(ctx, panelX, panelY, panelW, panelH, scene, lp, accent, elapsedSeconds)
  drawBrandFooter(ctx, width, height, elapsedSeconds, dur, scene)
}

function drawSopVideoFrame(ctx, width, height, storyboard, elapsedSeconds) {
  return drawProductDemoFrame(ctx, width, height, storyboard, elapsedSeconds)
}

export async function renderSopVideo(storyboard, options) {
  var opts = options || {}
  var onProgress = opts.onProgress, signal = opts.signal
  var width = opts.width || 1920, height = opts.height || 1080, fps = opts.fps || 30
  var support = getSopVideoRendererSupport()
  if (!support.supported) throw new Error(support.reason)
  var scenes = storyboard && storyboard.scenes
  if (!Array.isArray(scenes) || scenes.length === 0) throw new TypeError('分镜为空，无法生成视频')
  var durationSeconds = Number(storyboard.durationSeconds) || Number(scenes[scenes.length - 1].endTime)
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new TypeError('分镜时长无效')
  if (signal && signal.aborted) throw makeAbortError()
  var canvas = globalThis.document.createElement('canvas')
  canvas.width = width; canvas.height = height
  var ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建视频画布')
  var stream = canvas.captureStream(fps)
  var recorder = new MediaRecorder(stream, { mimeType: support.mimeType, videoBitsPerSecond: 8000000 })
  var chunks = []
  function nowFn() { return (globalThis.performance && globalThis.performance.now) ? globalThis.performance.now() : Date.now() }
  var requestFrame = globalThis.requestAnimationFrame || function(cb) { setTimeout(function() { cb(nowFn()) }, 16) }
  var cancelFrame = globalThis.cancelAnimationFrame || clearTimeout

  return new Promise(function(resolve, reject) {
    var startTime = 0, frameHandle = null, terminalError = null, settled = false
    function cleanup() {
      if (frameHandle !== null) cancelFrame(frameHandle)
      if (signal) signal.removeEventListener('abort', abort)
      stream.getTracks().forEach(function(t) { t.stop() })
    }
    function finish() {
      if (settled) return
      settled = true; cleanup()
      if (terminalError) return reject(terminalError)
      resolve(new Blob(chunks, { type: recorder.mimeType || support.mimeType }))
    }
    function stop() { if (recorder.state !== 'inactive') recorder.stop() }
    function abort() { terminalError = makeAbortError(); stop() }
    function frame(timestamp) {
      if (signal && signal.aborted) return abort()
      var elapsed = Math.min(durationSeconds, Math.max(0, (timestamp - startTime) / 1000))
      drawSopVideoFrame(ctx, width, height, storyboard, elapsed)
      if (onProgress) onProgress({ progress: clamp(elapsed / durationSeconds, 0, 1), elapsedSeconds: Math.round(elapsed), durationSeconds: durationSeconds })
      if (elapsed >= durationSeconds) return stop()
      frameHandle = requestFrame(frame)
    }
    recorder.ondataavailable = function(e) { if (e.data) chunks.push(e.data) }
    recorder.onstop = finish
    var s = nowFn()
    recorder.start(250)
    frame(s)
    if (signal) signal.addEventListener("abort", abort, { once: true })
  })
}
