// Verifies cordis.patch.yml against one or more DeepSeek Harness builds using the DSH patch
// parser and patch algorithm. Target builds are read as data only; their code never runs.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
const DISABLED: Record<string, string> = {
  'ui-settings-account': '@deepseek-ai/dsh-client-ui-settings-account',
  'ui-account-notifications': '@deepseek-ai/dsh-client-ui-account-notifications',
  'llm-deepseek-account': '@deepseek-ai/dsh-llm-deepseek-account',
}
const PROTECTED: Record<string, string> = {
  'deepseek-account': '@deepseek-ai/dsh-deepseek-account',
  credentials: '@deepseek-ai/dsh-credentials-local',
  authorization: '@deepseek-ai/dsh-authorization',
  'product-analytics': '@deepseek-ai/dsh-client-product-analytics',
}
// The verdict relies on these files; a target must match the checking build byte for byte.
const ENGINE_FILES = [
  '@deepseek-ai/cordis-plugin-include/src/patch.ts',
  '@deepseek-ai/dsh-app-boot/src/plugin-compatibility.ts',
]

interface Entry { id?: string, name?: string, disabled?: unknown, group?: boolean, config?: unknown, [key: string]: unknown }
type Patch = Record<string, unknown>

function parseArgs(argv: string[]): { dsh?: string, targets: string[], e2e: boolean } {
  const out = { dsh: undefined as string | undefined, targets: [] as string[], e2e: true }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dsh') out.dsh = argv[++i]
    else if (arg === '--target') out.targets.push(argv[++i])
    else if (arg === '--no-e2e') out.e2e = false
    else throw new Error(`unknown argument ${arg}`)
  }
  return out
}

// Outside DSH: re-run this script inside the DSH bundled runtime, which can read app.asar.
if (process.versions.electron === undefined) {
  const args = parseArgs(process.argv.slice(2))
  const exe = args.dsh ?? process.env.DSH_EXE
    ?? join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe')
  if (!existsSync(exe)) {
    console.error(`DeepSeek Harness executable not found: ${exe}\nPass --dsh <path to DeepSeek Harness.exe>.`)
    process.exit(2)
  }
  const forwarded = process.argv.slice(2).filter((_, i, all) => all[i] !== '--dsh' && all[i - 1] !== '--dsh')
  const result = spawnSync(exe, [fileURLToPath(import.meta.url), ...forwarded], {
    stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  process.exit(result.status ?? 1)
}

const args = parseArgs(process.argv.slice(2))
const engineAsar = join(dirname(process.execPath), 'resources', 'app.asar')
const engineModules = join(engineAsar, 'dsh', 'node_modules')
const engineUrl = (path: string) => pathToFileURL(join(engineModules, path)).href
const { loadOverlayPatches } = await import(engineUrl('@deepseek-ai/dsh-app-boot/lib/index.js'))
const { applyEntryPatches } = await import(engineUrl('@deepseek-ai/cordis-plugin-include/lib/index.js'))
const semver = createRequire(join(engineModules, 'noop.js'))('semver')

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const failures: string[] = []
const fail = (target: string, message: string) => { failures.push(`${target}: ${message}`) }

function rowsById(entries: Entry[], map = new Map<string, Entry>()): Map<string, Entry> {
  for (const entry of entries) {
    if (typeof entry.id === 'string') map.set(entry.id, entry)
    if (entry.group && Array.isArray(entry.config)) rowsById(entry.config as Entry[], map)
  }
  return map
}

function compose(patches: Patch[]): { rows: Map<string, Entry>, warnings: string[] } {
  const warnings: string[] = []
  const tree = applyEntryPatches([], structuredClone(patches), (format: string, ...rest: unknown[]) => {
    warnings.push(`${format} ${rest.map(String).join(' ')}`)
  })
  return { rows: rowsById(tree), warnings }
}

function bundlePatchFiles(modules: string, bundle: string): string[] {
  const manifest = readJson(join(modules, bundle, 'package.json'))
  const declared = manifest.dsh?.bundle?.patch
  const files = typeof declared === 'string' ? [declared] : declared
  if (!Array.isArray(files)) throw new Error(`${bundle} declares no dsh.bundle.patch`)
  return files.map((file: string) => join(modules, bundle, file))
}

const basePatches = (modules: string): Patch[] => BASE_BUNDLES
  .flatMap(bundle => bundlePatchFiles(modules, bundle))
  .flatMap(file => loadOverlayPatches('check', file))

function checkOwnPatch(patches: Patch[]): void {
  const ids = patches.map(patch => patch.id)
  if (JSON.stringify([...ids].sort()) !== JSON.stringify(Object.keys(DISABLED).sort())) {
    fail('cordis.patch.yml', `targets ${JSON.stringify(ids)}, expected exactly ${JSON.stringify(Object.keys(DISABLED))}`)
  }
  for (const patch of patches) {
    const keys = Object.keys(patch).sort().join(',')
    if (keys !== 'disabled,id,name') fail('cordis.patch.yml', `entry ${String(patch.id)} has keys ${keys}; only id, name, disabled are allowed`)
    if (patch.disabled !== true) fail('cordis.patch.yml', `entry ${String(patch.id)} must set disabled: true`)
    if (String(patch.id) in DISABLED && patch.name !== DISABLED[String(patch.id)]) fail('cordis.patch.yml', `entry ${String(patch.id)} must name ${DISABLED[String(patch.id)]}`)
  }
}

function checkComposition(label: string, before: Map<string, Entry>, after: Map<string, Entry>): void {
  for (const [id, name] of Object.entries(DISABLED)) {
    const row = after.get(id)
    if (row === undefined) { fail(label, `row ${id} not found`); continue }
    if (row.name !== name) fail(label, `row ${id} is ${String(row.name)}, expected ${name}`)
    if (row.disabled !== true) fail(label, `row ${id} is not disabled`)
    const original = before.get(id)
    if (original?.disabled === true) fail(label, `row ${id} was already disabled upstream; re-check the plugin`)
    const { disabled: _a, ...restAfter } = row
    const { disabled: _b, ...restBefore } = original ?? {}
    if (JSON.stringify(restAfter) !== JSON.stringify(restBefore)) fail(label, `row ${id} changed beyond "disabled"`)
  }
  for (const [id, name] of Object.entries(PROTECTED)) {
    const row = after.get(id)
    if (row === undefined) { fail(label, `protected row ${id} not found`); continue }
    if (row.name !== name) fail(label, `protected row ${id} is ${String(row.name)}, expected ${name}`)
    if (row.disabled === true) fail(label, `protected row ${id} is disabled`)
  }
  for (const [id, row] of after) {
    if (id in DISABLED) continue
    if (JSON.stringify(row) !== JSON.stringify(before.get(id))) fail(label, `unrelated row ${id} changed`)
  }
  if (after.size !== before.size) fail(label, `row count changed from ${before.size} to ${after.size}`)
}

function checkTarget(target: string, ownPatches: Patch[], range: string): void {
  const modules = join(target, 'dsh', 'node_modules')
  const version: string = readJson(join(modules, '@deepseek-ai/dsh-app-boot/package.json')).version
  const label = `${version} (${target})`
  if (!semver.satisfies(version, range, { includePrerelease: true })) fail(label, `engines.dsh "${range}" does not include ${version}`)
  for (const file of ENGINE_FILES) {
    if (!readFileSync(join(modules, file)).equals(readFileSync(join(engineModules, file)))) {
      fail(label, `${file} differs from the checking DSH build; run this check with that version's own DeepSeek Harness.exe`)
    }
  }
  const base = basePatches(modules)
  const before = compose(base)
  const after = compose([...base, ...ownPatches])
  for (const warning of after.warnings.slice(before.warnings.length)) fail(label, `loader warning from this plugin: ${warning}`)
  checkComposition(label, before.rows, after.rows)
  console.log(`checked ${label}: ${before.rows.size} rows, ${Object.keys(DISABLED).length} disabled by this plugin`)
}

// Boots nothing: runs the real `dsh --dump-config` on a throwaway profile in a temporary DSH_HOME.
function checkEndToEnd(range: string): void {
  const home = mkdtempSync(join(tmpdir(), 'dsh-no-account-e2e-'))
  const label = 'end-to-end dump-config'
  try {
    const profile = join(home, 'profiles', 'no-account-check')
    const pkg = join(profile, 'node_modules', 'dsh-no-account')
    mkdirSync(pkg, { recursive: true })
    for (const file of ['package.json', 'cordis.patch.yml']) cpSync(join(PLUGIN_DIR, file), join(pkg, file))
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      name: 'dsh-profile-no-account-check', private: true,
      dsh: { profile: { bundles: [...BASE_BUNDLES, 'dsh-no-account'] } },
    }))
    const bin = join(engineModules, '@deepseek-ai/dsh/lib/bin.js')
    const run = spawnSync(process.execPath, [bin, '--profile', 'no-account-check', '--dump-config'], {
      cwd: home, encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home },
    })
    if (run.status !== 0) { fail(label, `exit ${run.status}: ${run.stderr}`); return }
    if (run.stderr.trim() !== '') fail(label, `stderr: ${run.stderr.trim()}`)
    const dumpFile = join(home, 'dump.yml')
    writeFileSync(dumpFile, run.stdout)
    checkComposition(label, compose(basePatches(engineModules)).rows, rowsById(loadOverlayPatches('check', dumpFile)))
    console.log(`checked ${label}: bundle accepted under engines.dsh "${range}"`)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

const manifest = readJson(join(PLUGIN_DIR, 'package.json'))
const range: string = manifest.engines?.dsh
if (typeof range !== 'string') throw new Error('package.json engines.dsh is missing')
const ownPatches: Patch[] = loadOverlayPatches('check', join(PLUGIN_DIR, manifest.dsh.bundle.patch))
checkOwnPatch(ownPatches)
for (const target of args.targets.length > 0 ? args.targets.map(t => resolve(t)) : [engineAsar]) {
  checkTarget(target, ownPatches, range)
}
if (args.e2e) checkEndToEnd(range)

if (failures.length > 0) {
  console.error(`\nFAILED (${failures.length}):\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log('\nOK: dsh-no-account is compatible with every checked build.')
