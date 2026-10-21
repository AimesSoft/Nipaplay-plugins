const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load(values = {}, switches = { enable: true }) {
  const launches = [], logs = [];
  let running = false, stops = 0;
  const context = vm.createContext({
    settings: {
      getText: key => values[key] || '',
      getSwitch: key => switches[key] === true,
      setSwitch: (key, value) => { switches[key] = value; },
    },
    process: {
      start: (...args) => { launches.push(args); running = true; return true; },
      stop: () => { running = false; stops++; },
      isRunning: () => running,
    },
    dev: { log: value => logs.push(value), logError: value => logs.push(value) },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'steam_status_sync.js'), 'utf8'), context);
  return { context, launches, logs, stops: () => stops, running: () => running };
}

test('all configured variables are passed exactly, in a minimized terminal', () => {
  const values = {
    bridgePath: '/test/bridge', remoteControlPort: '1199', steamUsername: 'user',
    steamPassword: ' p\'"$HOME;\n密码 ', steamGuard: 'ABCDE', apiHost: 'localhost',
    pollInterval: '4000', notPlayingText: '休息中', dataDirectory: '/test/data',
  };
  const app = load(values, { enable: true, steamDebug: true });
  app.context.pluginOnInitialize();
  const [file, args, env, options] = JSON.parse(JSON.stringify(app.launches[0]));
  assert.equal(file, values.bridgePath);
  assert.deepEqual(args, []);
  assert.deepEqual(options, { window: 'minimized' });
  assert.deepEqual(env, {
    NIPAPLAY_API_PORT: '1199', STEAMUSERNAME: 'user', STEAMPASSWORD: values.steamPassword,
    STEAMGUARD: 'ABCDE', NIPAPLAY_API_HOST: 'localhost', POLL_INTERVAL_MS: '4000',
    NOT_PLAYING_TEXT: '休息中', BRIDGE_DATA_DIR: '/test/data', STEAM_DEBUG: '1',
  });
  assert.ok(!app.logs.join('\n').includes(values.steamPassword));
  assert.equal(app.context.pluginUIEntries.find(e => e.id === 'steamPassword').textSetting.obscureText, true);
});

test('empty optional values use Bridge defaults; invalid port uses 1180', () => {
  const app = load({ bridgePath: '/test/bridge', remoteControlPort: '99999' });
  app.context.pluginOnInitialize();
  assert.deepEqual(JSON.parse(JSON.stringify(app.launches[0][2])), { NIPAPLAY_API_PORT: '1180' });
});

test('restart explicitly applies changes; suspend preserves Bridge; destroy stops it', () => {
  const values = { bridgePath: '/test/bridge', steamUsername: 'before' };
  const app = load(values);
  app.context.pluginOnInitialize();
  values.steamUsername = 'after';
  app.context.pluginOnEvent({ name: 'settingsChanged' });
  app.context.pluginOnSuspend();
  app.context.pluginOnResume();
  assert.equal(app.launches.length, 1);
  app.context.pluginHandleUIAction('restartBridge');
  assert.equal(app.stops(), 1);
  assert.equal(app.launches[1][2].STEAMUSERNAME, 'after');
  app.context.pluginOnDestroy();
  assert.equal(app.stops(), 2);
  assert.equal(app.running(), false);
});

test('disabled or unconfigured plugin never auto-starts', () => {
  for (const app of [load({}, { enable: true }), load({ bridgePath: '/test/bridge' }, { enable: false })]) {
    app.context.pluginOnInitialize();
    assert.equal(app.launches.length, 0);
  }
});
