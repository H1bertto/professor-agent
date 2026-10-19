import { readFile } from 'fs/promises'
import { join } from 'path'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import {
  VRMLoaderPlugin,
  VRMLookAtBoneApplier,
  type VRM,
  type VRMHumanBoneName
} from '@pixiv/three-vrm'
import { beforeAll, describe, expect, it } from 'vitest'
import { EMOTIONS } from '../../../../shared/avatar'

const RESOURCES = join(__dirname, '..', '..', '..', '..', '..', 'resources', 'avatars')

async function loadVrm(file: string): Promise<VRM> {
  const data = await readFile(join(RESOURCES, file))
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  const loader = new GLTFLoader()
  loader.register((parser) => new VRMLoaderPlugin(parser))
  const gltf = await loader.parseAsync(buffer, '')
  const vrm = gltf.userData.vrm as VRM | undefined
  if (!vrm) throw new Error(`${file} is not a VRM model.`)
  return vrm
}

/** The summed morph weights of every mesh, to see whether an expression moves anything. */
function morphWeights(vrm: VRM): number {
  let total = 0
  vrm.scene.traverse((object) => {
    const mesh = object as THREE.Mesh
    for (const weight of mesh.morphTargetInfluences ?? []) total += weight
  })
  return total
}

describe('Hoot 3D', () => {
  let vrm: VRM

  beforeAll(async () => {
    vrm = await loadVrm('hoot.vrm')
  })

  it('is a VRM 1.0 model that anyone may share and change', () => {
    const meta = vrm.meta
    expect(meta.metaVersion).toBe('1')
    if (meta.metaVersion !== '1') return
    expect(meta.name).toBe('Hoot')
    expect(meta.allowRedistribution).toBe(true)
    expect(meta.modification).toBe('allowModificationRedistribution')
    expect(meta.commercialUsage).toBe('corporation')
  })

  it('has the bones the overlay moves', () => {
    const bones: VRMHumanBoneName[] = [
      'hips',
      'spine',
      'chest',
      'neck',
      'head',
      'leftEye',
      'rightEye',
      'leftShoulder',
      'rightShoulder',
      'leftUpperArm',
      'rightUpperArm'
    ]
    for (const bone of bones) expect(vrm.humanoid.getNormalizedBoneNode(bone), bone).not.toBeNull()
    expect(vrm.lookAt?.applier).toBeInstanceOf(VRMLookAtBoneApplier)
  })

  it('moves something for every expression the overlay uses', () => {
    const manager = vrm.expressionManager!
    for (const name of [...EMOTIONS.filter((emotion) => emotion !== 'neutral'), 'blink', 'aa']) {
      manager.resetValues()
      manager.update()
      const before = morphWeights(vrm)
      manager.setValue(name, 1)
      manager.update()
      expect(morphWeights(vrm), name).toBeGreaterThan(before)
    }
  })

  it('does not blink over a happy face', () => {
    const manager = vrm.expressionManager!
    manager.resetValues()
    manager.setValue('happy', 1)
    manager.update()
    const happy = morphWeights(vrm)
    manager.setValue('blink', 1)
    manager.update()
    expect(morphWeights(vrm)).toBe(happy)
  })

  it('swings the tassel with spring bones', () => {
    expect(vrm.springBoneManager?.joints.size).toBeGreaterThanOrEqual(3)
  })
})
