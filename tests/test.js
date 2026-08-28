// 逻辑测试:在 jsdom 里真实跑 index.html。
// 用法: cd tests && npm install jsdom && node test.js
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const DAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

function makeCloud(initial) {
  const state = { blob: initial ? JSON.parse(JSON.stringify(initial)) : {} };
  state.fetch = (url, opts) => {
    opts = opts || {};
    if (opts.method === 'PUT') {
      state.blob = JSON.parse(opts.body);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(JSON.stringify(state.blob))) });
  };
  return state;
}

// 测试专用假同步码 —— 别把真实同步码写进这个公开仓库
function boot({ localStore = null, cloud = null, confirmResult = true,
                url = 'https://davidlivesintemple.github.io/pomodoro-timer/?k=TESTKEY-TESTKEY-TESTKEY' } = {}) {
  return new JSDOM(HTML, {
    url, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      const mem = {};
      Object.defineProperty(win, 'localStorage', {
        value: {
          getItem: k => (k in mem ? mem[k] : null),
          setItem: (k, v) => { mem[k] = String(v); },
          removeItem: k => { delete mem[k]; },
        },
        configurable: true,
      });
      if (localStore) mem['pomo-hist'] = JSON.stringify(localStore);
      win.fetch = cloud ? cloud.fetch : () => Promise.reject(new Error('no net'));
      win.AudioContext = function () { throw new Error('no audio'); };
      win.confirm = () => confirmResult;
    },
  });
}

const wait = ms => new Promise(r => setTimeout(r, ms));
const readLocal = dom => JSON.parse(dom.window.localStorage.getItem('pomo-hist') || '{}');
const clock = dom => dom.window.document.getElementById('clock').textContent;
const btn = dom => dom.window.document.getElementById('main').textContent;
const hint = dom => dom.window.document.getElementById('hint').textContent;
const jarCount = dom => dom.window.document.querySelectorAll('#jar .it').length;

(async () => {
  console.log('\n[1] 冒烟:干净启动');
  {
    const dom = boot({});
    await wait(200);
    ok('初始 25:00', clock(dom) === '25:00', clock(dom));
    ok('按钮「开始」', btn(dom) === '开始', btn(dom));
    dom.window.close();
  }

  const oneRound = () => ({
    [DAY]: { seq: ['🍅', '☕'], ex: [], o: 'fs', rounds: 0, f: 1, s: 1, l: 0, x: 0, u: Date.now() },
  });

  console.log('\n[2] 往回挪指针:不抹掉做过的');
  {
    const dom = boot({ localStore: oneRound() });
    await wait(250);
    dom.window.document.getElementById('strip').children[0].click();
    await wait(80);
    const s = readLocal(dom)[DAY];
    ok('🍅 还是 1', s.f === 1, 'f=' + s.f);
    ok('☕ 还是 1', s.s === 1, 's=' + s.s);
    ok('位置退回开头', s.seq.length === 0, JSON.stringify(s.seq));
    dom.window.close();
  }

  console.log('\n[3] 往前跳 + 确认"做过":补录');
  {
    const dom = boot({ localStore: oneRound(), confirmResult: true });
    await wait(250);
    dom.window.document.getElementById('strip').children[4].click();   // 跳到第 3 个 🍅
    await wait(80);
    const s = readLocal(dom)[DAY];
    ok('补上 1 个 🍅', s.f === 2, 'f=' + s.f);
    ok('补上 1 个 ☕', s.s === 2, 's=' + s.s);
    ok('顺序串跟上', s.o === 'fsfs', s.o);
    ok('瓶里 4 个', jarCount(dom) === 4, jarCount(dom));
    dom.window.close();
  }

  console.log('\n[4] 往前跳 + 取消"没做":只挪位置,不造假记录');
  {
    const dom = boot({ localStore: oneRound(), confirmResult: false });
    await wait(250);
    const d = dom.window.document;
    d.getElementById('t-long').click();                 // 先点长休标签(用户的实际操作路径)
    await wait(50);
    d.getElementById('strip').children[4].click();      // 再跳到第 3 个 🍅
    await wait(80);
    const s = readLocal(dom)[DAY];
    ok('🍅 仍是 1,没凭空多', s.f === 1, 'f=' + s.f);
    ok('☕ 仍是 1', s.s === 1, 's=' + s.s);
    ok('顺序串没被污染', s.o === 'fs', s.o);
    ok('瓶里仍是 2 个,没有东西假掉落', jarCount(dom) === 2, jarCount(dom));
    ok('位置到了第 5 格', s.seq.length === 4, JSON.stringify(s.seq));
    ok('模式是专注', /保持专注/.test(hint(dom)), hint(dom));

    // 再跳一次也不会追补
    d.getElementById('strip').children[6].click();      // 第 4 个 🍅
    await wait(80);
    const s2 = readLocal(dom)[DAY];
    ok('反复跳也不产生记录', s2.f === 1 && s2.s === 1, `f=${s2.f} s=${s2.s}`);
    dom.window.close();
  }

  console.log('\n[5] 跳过之后正常跑完一段,照常计数');
  {
    const dom = boot({ localStore: oneRound(), confirmResult: false });
    await wait(250);
    const d = dom.window.document;
    d.getElementById('strip').children[4].click();      // 跳过到第 3 个 🍅
    await wait(80);
    d.getElementById('clock').click();
    await wait(30);
    const inp = d.getElementById('clock-in');
    inp.value = '0:01';
    inp.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(50);
    d.getElementById('main').click();
    await wait(1700);
    const s = readLocal(dom)[DAY];
    ok('真跑完的 🍅 计入', s.f === 2, 'f=' + s.f);
    ok('顺序串是 fsf', s.o === 'fsf', s.o);
    ok('位置推进到短休', /休息一下/.test(hint(dom)), hint(dom));
    dom.window.close();
  }

  console.log('\n[6] 弹窗被浏览器拦掉时,宁可少记不多记');
  {
    const dom = boot({ localStore: oneRound() });
    await wait(250);
    dom.window.confirm = () => { throw new Error('blocked'); };
    dom.window.document.getElementById('strip').children[4].click();
    await wait(80);
    const s = readLocal(dom)[DAY];
    ok('异常时不补录', s.f === 1 && s.s === 1, `f=${s.f} s=${s.s}`);
    ok('位置照样挪过去', s.seq.length === 4, JSON.stringify(s.seq));
    dom.window.close();
  }

  const afterFocus = () => ({
    [DAY]: { seq: ['🍅'], ex: [], o: 'f', rounds: 0, f: 1, s: 0, l: 0, x: 0, u: Date.now() },
  });
  const skipEl = dom => dom.window.document.getElementById('skip');

  console.log('\n[7] 「跳过这次休息」只在轮到休息、没开始计时的时候出现');
  {
    const dom = boot({ localStore: afterFocus() });
    await wait(250);
    const d = dom.window.document;
    ok('刚做完一个番茄,轮到短休', /休息一下/.test(hint(dom)), hint(dom));
    ok('跳过链接可见', skipEl(dom).className === 'on', skipEl(dom).className);
    d.getElementById('main').click();                    // 开始计时
    await wait(60);
    ok('计时中隐藏', skipEl(dom).className === '', skipEl(dom).className);
    d.getElementById('main').click();                    // 暂停
    await wait(60);
    ok('中途暂停也能跳(歇到一半被叫走的情况)', skipEl(dom).className === 'on', skipEl(dom).className);
    d.getElementById('t-focus').click();                 // 切到专注
    await wait(60);
    ok('专注模式下隐藏', skipEl(dom).className === '', skipEl(dom).className);
    dom.window.close();
  }

  console.log('\n[8] 聊了 15 分钟回来:跳过短休,选"歇过了"');
  {
    const dom = boot({ localStore: afterFocus(), confirmResult: true });
    await wait(250);
    skipEl(dom).click();
    await wait(80);
    const s = readLocal(dom)[DAY];
    ok('记了 1 个 ☕', s.s === 1, 's=' + s.s);
    ok('顺序串 fs', s.o === 'fs', s.o);
    ok('进到第 2 个番茄', /保持专注/.test(hint(dom)), hint(dom));
    ok('25:00 待命', clock(dom) === '25:00', clock(dom));
    ok('瓶里 2 个', jarCount(dom) === 2, jarCount(dom));
    ok('跳过链接收起', skipEl(dom).className === '', skipEl(dom).className);
    dom.window.close();
  }

  console.log('\n[9] 跳过短休,选"没歇":位置前进,不记录');
  {
    const dom = boot({ localStore: afterFocus(), confirmResult: false });
    await wait(250);
    skipEl(dom).click();
    await wait(80);
    const s = readLocal(dom)[DAY];
    ok('☕ 仍是 0', s.s === 0, 's=' + s.s);
    ok('顺序串仍是 f', s.o === 'f', s.o);
    ok('进到第 2 个番茄', /保持专注/.test(hint(dom)), hint(dom));
    ok('位置在第 3 格', s.seq.length === 2, JSON.stringify(s.seq));
    dom.window.close();
  }

  console.log('\n[10] 一轮末尾跳过长休 → 回到新一轮开头');
  {
    const dom = boot({
      localStore: { [DAY]: { seq: ['🍅','☕','🍅','☕','🍅','☕','🍅'], ex: [], o: 'fsfsfsf',
                            rounds: 0, f: 4, s: 3, l: 0, x: 0, u: Date.now() } },
      confirmResult: false,
    });
    await wait(250);
    ok('轮到长休', /好好休息/.test(hint(dom)), hint(dom));
    ok('跳过链接可见', skipEl(dom).className === 'on');
    skipEl(dom).click();
    await wait(80);
    const s = readLocal(dom)[DAY];
    ok('本轮归零', s.seq.length === 0, JSON.stringify(s.seq));
    ok('回到专注', /保持专注/.test(hint(dom)), hint(dom));
    ok('长休没被记', s.l === 0, 'l=' + s.l);
    dom.window.close();
  }

  console.log('\n[11] 本地和云端各有一个在跑的计时 → 不能叠成两个,完成只算一次');
  {
    const endAt = Date.now() + 1200;
    const cloud = makeCloud({
      _run: { mode: 'focus', endAt, remaining: 1500, running: true, freeSec: 900, u: Date.now() },
    });
    const dom = boot({
      localStore: { _run: { mode: 'focus', endAt, remaining: 1500, running: true, freeSec: 900, u: Date.now() - 5000 } },
      cloud,
    });
    await wait(3200);                                   // 到点后再多等 2 秒
    const s = readLocal(dom);
    const day = Object.keys(s).filter(k => !k.startsWith('_'))[0];
    ok('只记了 1 个 🍅,没有被反复触发', s[day] && s[day].f === 1, 'f=' + (s[day] && s[day].f));
    ok('已经停下来', btn(dom) === '开始', btn(dom));
    ok('进入短休', /休息一下/.test(hint(dom)), hint(dom));
    dom.window.close();
  }

  console.log('\n[12] 完成时不再出声,改为圆环抖动');
  {
    const dom = boot({});
    await wait(200);
    const d = dom.window.document;
    let audioCalls = 0;
    dom.window.AudioContext = function(){ audioCalls++; throw new Error('should not be used'); };
    d.getElementById('clock').click();
    await wait(30);
    const inp = d.getElementById('clock-in');
    inp.value = '0:01';
    inp.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(50);
    d.getElementById('main').click();
    await wait(1500);
    ok('没有调用音频', audioCalls === 0, 'AudioContext 调用 ' + audioCalls + ' 次');
    ok('圆环收到抖动', d.querySelector('.ring').classList.contains('buzz'));
    dom.window.close();
  }

  console.log('\n────────────────');
  console.log(pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试脚本崩了:', e); process.exit(2); });
