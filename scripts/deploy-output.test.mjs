import assert from 'node:assert/strict'
import test from 'node:test'
import { parse, resolve } from 'node:path'
import { resolveInstallRoot } from './deploy-output.mjs'

const projectDirectory = resolve('test-fixtures', 'MisHistorias')

test('usa una ruta relativa al proyecto por defecto', () => {
  assert.equal(
    resolveInstallRoot([], {}, projectDirectory),
    resolve(projectDirectory, '..', 'MisHistoriasInstall')
  )
})

test('acepta ruta relativa o absoluta mediante variable de entorno', () => {
  assert.equal(
    resolveInstallRoot([], { MISHISTORIAS_INSTALL_ROOT: '../portable' }, projectDirectory),
    resolve(projectDirectory, '..', 'portable')
  )

  const absoluteRoot = resolve('test-fixtures', 'custom-install')
  assert.equal(
    resolveInstallRoot([], { MISHISTORIAS_INSTALL_ROOT: absoluteRoot }, projectDirectory),
    absoluteRoot
  )
})

test('el parámetro tiene prioridad sobre la variable de entorno', () => {
  assert.equal(
    resolveInstallRoot(
      ['--', '--install-root', '../from-argument'],
      { MISHISTORIAS_INSTALL_ROOT: '../from-environment' },
      projectDirectory
    ),
    resolve(projectDirectory, '..', 'from-argument')
  )

  assert.equal(
    resolveInstallRoot(['--install-root=../inline'], {}, projectDirectory),
    resolve(projectDirectory, '..', 'inline')
  )
})

test('rechaza parámetros inválidos y raíces de unidad', () => {
  assert.throws(
    () => resolveInstallRoot(['--install-root'], {}, projectDirectory),
    /--install-root requiere una ruta/
  )
  assert.throws(
    () => resolveInstallRoot(['--unknown'], {}, projectDirectory),
    /Parámetro no reconocido/
  )
  assert.throws(
    () => resolveInstallRoot(['--install-root', parse(projectDirectory).root], {}, projectDirectory),
    /raíz de una unidad/
  )
})
