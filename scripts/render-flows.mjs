#!/usr/bin/env node
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'docs', 'flows.md')
const outDir = join(root, 'docs', 'diagrams')

mkdirSync(outDir, { recursive: true })

const content = readFileSync(src, 'utf8')
const blocks = [...content.matchAll(/## (.+?)\n[\s\S]*?```mermaid\n([\s\S]+?)\n```/g)]

if (!blocks.length) {
  console.error('No mermaid blocks found in', src)
  process.exit(1)
}

for (const match of blocks) {
  const name = match[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const mmdPath = join(outDir, `${name}.mmd`)
  const pngPath = join(outDir, `${name}.png`)

  writeFileSync(mmdPath, match[2].trim())

  process.stdout.write(`Rendering ${name}... `)
  try {
    execSync(`mmdc -i "${mmdPath}" -o "${pngPath}" -b white -w 1600`, { stdio: 'pipe' })
    console.log('done')
  } catch (e) {
    console.log('FAILED')
    console.error(e.stderr?.toString())
  }
}

console.log(`\n${blocks.length} diagrams written to docs/diagrams/`)
console.log('To print: lpr docs/diagrams/*.png')
