// A small glTF 2.0 writer for avatars made of plain shapes: nodes, meshes with morph targets,
// materials, and one embedded image. It writes the binary form (GLB) that VRM files use.

const FLOAT = 5126
const UNSIGNED_SHORT = 5123
const UNSIGNED_INT = 5125
const ARRAY_BUFFER = 34962
const ELEMENT_ARRAY_BUFFER = 34963

export interface Geometry {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
}

export interface Primitive {
  geometry: Geometry
  material: number
  /** The position of every vertex after each morph target, in the same order as the mesh's. */
  targets?: Float32Array[]
}

type Json = Record<string, unknown>

export class GltfBuilder {
  readonly nodes: Json[] = []
  readonly meshes: Json[] = []
  readonly materials: Json[] = []
  readonly images: Json[] = []
  private readonly accessors: Json[] = []
  private readonly bufferViews: Json[] = []
  private readonly chunks: Buffer[] = []
  private byteLength = 0

  addNode(node: Json): number {
    this.nodes.push(node)
    return this.nodes.length - 1
  }

  addMaterial(material: Json): number {
    this.materials.push(material)
    return this.materials.length - 1
  }

  /** A mesh whose primitives all have the same morph targets, named in `targetNames`. */
  addMesh(name: string, primitives: Primitive[], targetNames: string[] = []): number {
    const json: Json = {
      name,
      primitives: primitives.map((primitive) => this.primitive(primitive, targetNames.length))
    }
    if (targetNames.length > 0) {
      json.weights = targetNames.map(() => 0)
      json.extras = { targetNames }
    }
    this.meshes.push(json)
    return this.meshes.length - 1
  }

  addImage(data: Buffer, mimeType: string, name: string): number {
    this.images.push({ name, mimeType, bufferView: this.bufferView(data) })
    return this.images.length - 1
  }

  /** The GLB file, with the scene, the extensions, and everything added so far. */
  glb(document: Json): Buffer {
    const json: Json = {
      asset: { version: '2.0', generator: 'Professor Agent avatar generator' },
      ...document,
      nodes: this.nodes,
      meshes: this.meshes,
      materials: this.materials,
      accessors: this.accessors,
      bufferViews: this.bufferViews,
      buffers: [{ byteLength: this.byteLength }]
    }
    if (this.images.length > 0) json.images = this.images
    const text = pad(Buffer.from(JSON.stringify(json)), 0x20)
    const binary = pad(Buffer.concat(this.chunks), 0)
    const header = Buffer.alloc(12)
    header.write('glTF', 0, 'ascii')
    header.writeUInt32LE(2, 4)
    header.writeUInt32LE(12 + 8 + text.length + 8 + binary.length, 8)
    return Buffer.concat([
      header,
      chunkHeader(text, 'JSON'),
      text,
      chunkHeader(binary, 'BIN\0'),
      binary
    ])
  }

  private primitive(primitive: Primitive, targetCount: number): Json {
    const { geometry } = primitive
    const count = geometry.positions.length / 3
    const targets = primitive.targets ?? []
    if (targets.length !== targetCount) {
      throw new Error(`A primitive has ${targets.length} morph targets, not ${targetCount}.`)
    }
    const json: Json = {
      attributes: {
        POSITION: this.vectors(geometry.positions, true),
        NORMAL: this.vectors(geometry.normals, false)
      },
      indices: this.indices(geometry.indices, count),
      material: primitive.material,
      mode: 4
    }
    if (targets.length > 0) {
      json.targets = targets.map((target) => {
        if (target.length !== geometry.positions.length) {
          throw new Error('A morph target must move every vertex of its primitive.')
        }
        const offsets = target.map((value, index) => value - geometry.positions[index])
        return { POSITION: this.vectors(offsets, true) }
      })
    }
    return json
  }

  private vectors(values: Float32Array, bounds: boolean): number {
    const accessor: Json = {
      bufferView: this.bufferView(
        Buffer.from(values.buffer, values.byteOffset, values.byteLength),
        ARRAY_BUFFER
      ),
      componentType: FLOAT,
      count: values.length / 3,
      type: 'VEC3'
    }
    if (bounds) {
      const min = [Infinity, Infinity, Infinity]
      const max = [-Infinity, -Infinity, -Infinity]
      values.forEach((value, index) => {
        min[index % 3] = Math.min(min[index % 3], value)
        max[index % 3] = Math.max(max[index % 3], value)
      })
      accessor.min = min
      accessor.max = max
    }
    this.accessors.push(accessor)
    return this.accessors.length - 1
  }

  private indices(indices: Uint32Array, vertexCount: number): number {
    const small = vertexCount <= 0xffff
    const typed = small ? Uint16Array.from(indices) : indices
    this.accessors.push({
      bufferView: this.bufferView(
        Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength),
        ELEMENT_ARRAY_BUFFER
      ),
      componentType: small ? UNSIGNED_SHORT : UNSIGNED_INT,
      count: indices.length,
      type: 'SCALAR'
    })
    return this.accessors.length - 1
  }

  private bufferView(data: Buffer, target?: number): number {
    const view: Json = { buffer: 0, byteOffset: this.byteLength, byteLength: data.length }
    if (target) view.target = target
    this.bufferViews.push(view)
    const padded = pad(data, 0)
    this.chunks.push(padded)
    this.byteLength += padded.length
    return this.bufferViews.length - 1
  }
}

/** glTF chunks and buffer views start on 4-byte boundaries. */
function pad(data: Buffer, fill: number): Buffer {
  const extra = (4 - (data.length % 4)) % 4
  return extra === 0 ? data : Buffer.concat([data, Buffer.alloc(extra, fill)])
}

function chunkHeader(data: Buffer, type: string): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32LE(data.length, 0)
  header.write(type, 4, 'ascii')
  return header
}
