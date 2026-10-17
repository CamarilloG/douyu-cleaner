/* Native flying-danmaku interaction. Never copies or redraws the danmaku layer. */
(function (global) {
    'use strict';

    function inside(rect, x, y, padding = 0) {
        return rect && x >= rect.left - padding && x <= rect.right + padding &&
            y >= rect.top - padding && y <= rect.bottom + padding;
    }

    function readable(item, readText) {
        // A platform adapter must additionally exclude badges, gifts and system messages.
        if (!item) return null;
        const text = readText(item);
        return typeof text === 'string' && text.trim() && !text.includes('\uFFFC') ? text.trim() : null;
    }

    function hitTest(items, x, y, readText, rootRect) {
        if (!inside(rootRect, x, y)) return null;
        // Prefer the last painted item, and cap work on very busy rooms.
        const list = Array.from(items).slice(-500);
        for (let i = list.length - 1; i >= 0; i--) {
            const item = list[i];
            if (!item.isConnected) continue;
            const rect = item.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0 || !inside(rect, x, y)) continue;
            const style = item.ownerDocument.defaultView.getComputedStyle(item);
            if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
            const text = readable(item, readText);
            if (text) return { item, text, rect };
        }
        return null;
    }

    function createSender(send, roomKey, now = Date.now, cooldownMs = 1200) {
        let pending = false;
        let destroyed = false;
        let lastAttempt = -Infinity;
        return {
            destroy() { destroyed = true; },
            async submit(snapshot) {
                if (destroyed || snapshot.room !== roomKey()) return { status: 'failed', message: '房间已变化，请重新选择弹幕' };
                if (pending || now() - lastAttempt < cooldownMs) return { status: 'failed', message: '请稍后再试' };
                pending = true;
                lastAttempt = now();
                try {
                    const result = await send(snapshot.text);
                    if (result && ['sent', 'submitted', 'failed'].includes(result.status)) return result;
                    return { status: 'submitted', message: '已提交，请查看原站发送结果' };
                } catch (error) {
                    return { status: 'failed', message: '发送失败，请在原站确认登录、禁言和发送冷却状态' };
                } finally {
                    pending = false;
                }
            }
        };
    }

    function mount(options) {
        const { root, readText, send, roomKey } = options;
        if (!root || !root.ownerDocument || typeof readText !== 'function' || typeof send !== 'function' || typeof roomKey !== 'function') {
            throw new TypeError('Native repeat requires root, readText, send and roomKey');
        }
        const doc = root.ownerDocument;
        const win = doc.defaultView;
        const sender = createSender(send, roomKey);
        const layer = doc.createElement('div');
        layer.className = 'lc-native-repeat-layer';
        layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2147483646;overflow:visible;';
        const button = doc.createElement('button');
        button.type = 'button';
        button.textContent = '+1';
        button.hidden = true;
        button.style.cssText = 'position:absolute;pointer-events:auto;min-width:36px;height:28px;padding:0 8px;border:1px solid #ffffff99;border-radius:6px;background:#17191feb;color:white;font:600 14px/26px sans-serif;cursor:pointer;box-shadow:0 2px 8px #0008;white-space:nowrap;';
        const notice = doc.createElement('div');
        notice.setAttribute('role', 'status');
        notice.style.cssText = 'position:absolute;left:50%;bottom:64px;transform:translateX(-50%);max-width:85%;padding:8px 12px;border-radius:6px;background:#17191feb;color:white;font:14px/1.5 sans-serif;display:none;';
        layer.append(button, notice);
        let host = null, restorePosition = null, selected = null, resume = [], frame = 0;
        let hideTimer = 0, noticeTimer = 0, destroyed = false, point = null, sending = false;
        const initialRoom = roomKey();

        function attach() {
            const full = doc.fullscreenElement;
            const next = full && root.contains(full) ? full : root;
            if (host === next) return;
            clear();
            if (restorePosition) restorePosition();
            host = next;
            restorePosition = null;
            if (win.getComputedStyle(host).position === 'static') {
                const old = host.style.position;
                host.style.position = 'relative';
                restorePosition = () => { if (host.style.position === 'relative') host.style.position = old; };
            }
            host.appendChild(layer);
        }

        function clear() {
            win.clearTimeout(hideTimer);
            hideTimer = 0;
            selected = null;
            button.hidden = true;
            for (const animation of resume) {
                try { if (animation.playState === 'paused') animation.play(); } catch (_) { /* removed animation */ }
            }
            resume = [];
        }

        function showNotice(message) {
            notice.textContent = message;
            notice.style.display = 'block';
            win.clearTimeout(noticeTimer);
            noticeTimer = win.setTimeout(() => { notice.style.display = 'none'; }, 3000);
        }

        function select(hit) {
            clear();
            selected = { ...hit, room: roomKey(), selectedAt: Date.now() };
            // Pause only running Web Animations. JS-driven transforms remain untouched.
            if (hit.item.getAnimations) {
                for (const animation of hit.item.getAnimations()) {
                    if (animation.playState === 'running') {
                        try { animation.pause(); resume.push(animation); } catch (_) { /* unsupported animation */ }
                    }
                }
            }
            const bounds = host.getBoundingClientRect();
            const sx = bounds.width ? (host.clientWidth || bounds.width) / bounds.width : 1;
            const sy = bounds.height ? (host.clientHeight || bounds.height) / bounds.height : 1;
            // Anchor to the selected snapshot so a moving DOM item cannot change the click target.
            button.style.left = Math.max(0, Math.min((hit.rect.right - bounds.left + 5) * sx, (host.clientWidth || bounds.width) - 42)) + 'px';
            button.style.top = Math.max(0, Math.min((hit.rect.top - bounds.top) * sy, (host.clientHeight || bounds.height) - 30)) + 'px';
            button.title = '复读：' + hit.text;
            button.setAttribute('aria-label', '复读弹幕：' + hit.text);
            button.hidden = false;
        }

        function inspect() {
            frame = 0;
            if (destroyed || !point || sending) return;
            if (roomKey() !== initialRoom) { clear(); return; }
            const { x, y } = point;
            if (selected) {
                const buttonRect = button.getBoundingClientRect();
                const buttonActive = inside(buttonRect, x, y, 8) || doc.activeElement === button;
                if (!selected.item.isConnected || (!buttonActive && readable(selected.item, readText) !== selected.text)) {
                    clear();
                } else if (buttonActive || (inside(selected.rect, x, y, 8) &&
                    (Date.now() - selected.selectedAt < 2000 || inside(selected.item.getBoundingClientRect(), x, y, 8)))) {
                    win.clearTimeout(hideTimer); hideTimer = 0; return;
                }
            }
            const items = options.getItems ? options.getItems() : root.querySelectorAll(options.itemSelector);
            const hit = hitTest(items, x, y, readText, host.getBoundingClientRect());
            if (hit) select(hit);
            else if (selected && !hideTimer) hideTimer = win.setTimeout(clear, 350);
        }

        function move(event) {
            if (event.pointerType === 'touch') return;
            if (!host || !inside(host.getBoundingClientRect(), event.clientX, event.clientY)) { leave(event); return; }
            point = { x: event.clientX, y: event.clientY };
            if (!frame) frame = win.requestAnimationFrame(inspect);
        }
        function leave(event) {
            if (layer.contains(event.relatedTarget)) return;
            point = null;
            if (!hideTimer) hideTimer = win.setTimeout(clear, 350);
        }
        function buttonEnter() { win.clearTimeout(hideTimer); hideTimer = 0; }
        function stop(event) { event.stopPropagation(); }
        async function click(event) {
            event.preventDefault(); event.stopPropagation();
            if (!selected || sending) return;
            const snapshot = { text: selected.text, room: selected.room };
            sending = true;
            button.disabled = true;
            const result = await sender.submit(snapshot);
            sending = false;
            button.disabled = false;
            if (destroyed || snapshot.room !== roomKey()) return;
            showNotice(result.message || ({ sent: '已发送', submitted: '已提交，请查看原站发送结果', failed: '发送失败' })[result.status]);
            clear();
        }
        function contextChanged() { clear(); }
        // Document capture also handles a fullscreen native layer with pointer-events:none:
        // its events can target the page rather than the (smaller) original player root.
        doc.addEventListener('pointermove', move, true);
        doc.addEventListener('pointerleave', leave);
        button.addEventListener('pointerenter', buttonEnter);
        button.addEventListener('pointerdown', stop);
        button.addEventListener('dblclick', event => { event.preventDefault(); event.stopPropagation(); });
        button.addEventListener('click', click);
        doc.addEventListener('fullscreenchange', attach);
        win.addEventListener('resize', contextChanged);
        win.addEventListener('scroll', contextChanged, true);
        // Hover is the entry point, but the revealed control can also be focused.
        button.addEventListener('focus', buttonEnter);
        button.addEventListener('blur', contextChanged);
        attach();
        // New native messages also pass under a stationary cursor. Poll only while in the player.
        const hoverTimer = win.setInterval(() => { if (point && !frame) frame = win.requestAnimationFrame(inspect); }, 180);
        return {
            destroy() {
                if (destroyed) return;
                destroyed = true;
                sender.destroy(); clear();
                win.cancelAnimationFrame(frame);
                win.clearTimeout(noticeTimer);
                win.clearInterval(hoverTimer);
                doc.removeEventListener('pointermove', move, true);
                doc.removeEventListener('pointerleave', leave);
                doc.removeEventListener('fullscreenchange', attach);
                win.removeEventListener('resize', contextChanged);
                win.removeEventListener('scroll', contextChanged, true);
                layer.remove();
                if (restorePosition) restorePosition();
            }
        };
    }
    const api = { mount, hitTest, createSender };
    if (typeof module === 'object' && module.exports) module.exports = api;
    global.LiveCleanerNativeRepeat = api;
})(typeof globalThis === 'object' ? globalThis : window);
