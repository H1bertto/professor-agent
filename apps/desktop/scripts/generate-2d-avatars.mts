// Generates the built-in 2D avatars, Chalk, Lia, Theo, and Hoot, as SVG drawings.
// It writes one image per emotion and mouth/eye state for each, plus its avatar.json manifest.
// Run it with `npm run generate:avatars` after changing a drawing.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FACES, type Character2D } from './avatars/face.mts'
import { HOOT } from './avatars/hoot.mts'
import { CHALK, LIA, THEO } from './avatars/teachers.mts'

const AVATARS = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'avatars')

async function generate(character: Character2D): Promise<void> {
  const output = join(AVATARS, character.folder)
  await mkdir(output, { recursive: true })
  const emotions: Record<string, { idle: string; talking: string; blinking: string }> = {}
  for (const [emotion, face] of Object.entries(FACES)) {
    const files = {
      idle: `${emotion}.svg`,
      talking: `${emotion}-talking.svg`,
      blinking: `${emotion}-blinking.svg`
    }
    await writeFile(
      join(output, files.idle),
      character.draw(face, { talking: false, blinking: false })
    )
    await writeFile(
      join(output, files.talking),
      character.draw(face, { talking: true, blinking: false })
    )
    await writeFile(
      join(output, files.blinking),
      character.draw(face, { talking: false, blinking: true })
    )
    emotions[emotion] = files
  }
  const manifest = {
    format: 'professor-agent/pngtuber',
    version: 1,
    name: character.name,
    emotions
  }
  await writeFile(join(output, 'avatar.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Wrote ${Object.keys(emotions).length * 3} images and avatar.json to ${output}`)
}

for (const character of [CHALK, LIA, THEO, HOOT]) await generate(character)
