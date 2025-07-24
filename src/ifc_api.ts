import { ConwayGeometry, FileHandlerFunction as FileHandlerCallback,
 } from '@bldrs-ai/conway'
import {versionString} from '@bldrs-ai/conway/src/version/version'
import Logger from '@bldrs-ai/conway/src/logging/logger'
import Environment from '@bldrs-ai/conway/src/utilities/environment'
import * as glmatrix from 'gl-matrix'
import { IfcApiModelPassthrough } from './ifc_api_model_passthrough'
import { IfcApiModelPassthroughFactory } from './ifc_api_model_passthrough_factory'
import { Properties } from './properties'


export * from './ifc2x4'


export const UNKNOWN = 0
export const STRING = 1
export const LABEL = 2
export const ENUM = 3
export const REAL = 4
export const REF = 5
export const EMPTY = 6
export const SET_BEGIN = 7
export const SET_END = 8
export const LINE_END = 9

export interface Loadersettings {
  COORDINATE_TO_ORIGIN: boolean
  USE_FAST_BOOLS: boolean
  CIRCLE_SEGMENTS_LOW?: number
  CIRCLE_SEGMENTS_MEDIUM?: number
  CIRCLE_SEGMENTS_HIGH?: number
  BOOL_ABORT_THRESHOLD?: number
}

export interface Vector<T> {
  get(index: number): T
  push(parameter: T): void
  size(): number
}

export interface Color {
  x: number
  y: number
  z: number
  w: number
}

export interface PlacedGeometry {
  color: Color
  geometryExpressID: number
  flatTransformation: Array<number>
}

export interface FlatMesh {
  geometries: Vector<PlacedGeometry>
  expressID: number
}

export interface RawLineData {
  ID: number
  type: number
  arguments: any[]
}

export interface LoaderError {
  type: string
  message: string
  expressID: number
  ifcType: number
}

export interface IfcGeometry {
  GetVertexData(): number
  GetVertexDataSize(): number
  GetIndexData(): number
  GetIndexDataSize(): number
}

/**
 * @return {number} current time in ms
 */
export function ms(): number {
  return new Date().getTime()
}

export type LocateFileHandlerFn = FileHandlerCallback

/**
 * IfcAPI - Web-IFC API Shim Implementation for full read functionality
 */
export class IfcAPI {
  wasmModule: undefined | any = undefined
  fs: undefined | any = undefined
  wasmPath: string = ''
  isWasmPathAbsolute = false
  settings: Loadersettings | undefined
  globalModelIDCounter = 0
  models = new Map<number, IfcApiModelPassthrough>()
  conwaywasm = new ConwayGeometry()
  _isCoordinated: boolean = false
  linearScalingFactor: number = 1
  identity: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

  // Initialize the matrix using an array
  NormalizeMat: glmatrix.mat4 = glmatrix.mat4.fromValues(
      1, 0, 0, 0,  // First column
      0, 0, -1, 0, // Second column
      0, 1, 0, 0,  // Third column
      0, 0, 0, 1,   // Fourth column
  )

  properties = new Properties(this)

  /**
   * Get the passthrough for a particular model id.
   *
   * @param modelID
   * @return {IfcApiModelPassthrough | undefined}
   */
  public getPassthrough( modelID: number ): IfcApiModelPassthrough | undefined {
    return this.models.get( modelID )
  }

  /**
   * Initializes the WASM module (WebIFCWasm), required before using any other functionality.
   *
   * @param customLocateFileHandler An optional locateFile function that let's
   * you override the path from which the wasm module is loaded.
   */
  async Init(customLocateFileHandler?: LocateFileHandlerFn) {
    Environment.checkEnvironment()
    Logger.initializeWasmCallbacks()
    Logger.info(versionString)
    const locateFileHandler: LocateFileHandlerFn = (path, prefix) => {
      // when the wasm module requests the wasm file, we redirect to include the user specified path
      if (path.endsWith('.wasm')) {
        if (this.isWasmPathAbsolute) {
          return this.wasmPath + path
        }

        return prefix + this.wasmPath + path
      }
      // otherwise use the default path
      return prefix + path
    }

    // @ts-ignore
    const initializationStatus = await
    this.conwaywasm.initialize((customLocateFileHandler !== void 0) ?
        customLocateFileHandler : locateFileHandler)

    if (!initializationStatus) {
      Logger.error('Could not initialize Conway Wasm')
      return
    }

    this.wasmModule = this.conwaywasm.wasmModule
  }

  /**
   * Opens a model and returns a modelID number
   *
   * @param data containing IFC data (bytes)
   * @param settings settings for loading the model
   * @return {number} model ID
   */
  OpenModel(data: Uint8Array, settings?: Loadersettings): number {

    const modelIdResult = this.globalModelIDCounter

    const result =
      IfcApiModelPassthroughFactory.from(
          modelIdResult,
          data,
          this.wasmModule,
          settings)

    if ( result === void 0 ) {
      return -1
    }

    this.globalModelIDCounter++

    this.models.set( modelIdResult, result )

    return modelIdResult
  }


  /**
   * Creates a new model and returns a modelID number (unimplemented)
   *
   * @param settings settings for generating data the model
   * @return {number} model ID
   */
  CreateModel(settings?: Loadersettings): number {

    Logger.warning('[CreateModel]: Shim - Unimplemented')
    return 0
  }

  /**
   *
   * @param modelID
   * @return {Uint8Array} unimplemented
   */
  ExportFileAsIFC(modelID: number): Uint8Array {
    Logger.warning(`[ExportFileAsIFC]: Model ${modelID}: Shim - Unimplemented`)
    const emptyArray = new Uint8Array(1)
    return emptyArray
  }


  /**
   * Opens a model and returns a modelID number
   *
   * @param modelID handle retrieved by OpenModel, model must not be closed
   * @param geometryExpressID containing IFC data (bytes)
   * @return {IfcGeometry}
   */
  GetGeometry(modelID: number, geometryExpressID: number): IfcGeometry {
    const result = this.models.get(modelID)

    if (result !== void 0) {

      return result.getGeometry(geometryExpressID)

    } else {

      Logger.error('[GetGeometry]: model === undefined')
    }

    Logger.error('[GetGeometry]: Error - returning dummyGeometry object')

    const dummyGeometry: IfcGeometry = (new (this.wasmModule.IfcGeometry)())

    return dummyGeometry
  }

  /**
   *
   * @param modelID
   * @param expressID
   * @param flatten
   * @return {any} line data
   */
  GetLine(modelID: number, expressID: number, flatten: boolean = false) {

    const result = this.models.get(modelID)

    if (result === void 0) {

      Logger.error('[GetLine]: model === undefined')
      return
    }

    return result.getLine(expressID, flatten)
  }

  /**
   *
   * @param modelID
   * @return {Vector<LoaderError>}
   */
  GetAndClearErrors(modelID: number): Vector<LoaderError> {
    Logger.warning('[GetAndClearErrors]: Shim - Unimplemented')
    const wasmErrorsDummy: Vector<LoaderError> = {
      get(index: number): LoaderError {
        // Implementation here
        return { type: '', message: '', expressID: 0, ifcType: 0 }
      },
      size(): number {
        // Implementation here
        return 0
      },
      push(): void {
        // eslint-disable-next-line no-useless-return
        return
      },
    }

    return wasmErrorsDummy
  }

  /**
   *
   * @param modelID
   * @param lineObject
   */
  WriteLine(modelID: number, lineObject: any) {
    Logger.warning('[WriteLine]: Shim - Unimplemented')
  }

  /**
   *
   * @param modelID
   * @param line
   * @return {string | undefined}
   */
  FlattenLine(modelID: number, line: any) {
    const result = this.models.get(modelID)

    if (result === void 0) {

      Logger.error('[FlattenLine]: model === undefined')
      return
    }

    return result.flattenLine(line)
  }

  /**
   *
   * @param modelID
   * @param expressID
   * @return {RawLineData}
   */
  GetRawLineData(modelID: number, expressID: number): RawLineData {

    const result = this.models.get(modelID)

    if (result === void 0) {

      Logger.error('[GetRawLineData]: model === undefined')

      return {
        ID: expressID,
        type: -1,
        arguments: ['invalid'],
      }
    }

    return result.getRawLineData(expressID)

  }


  /**
   * Get all line ids with the matching type
   *
   * @param modelID
   * @param type
   * @return {Vector<number>} The matching express IDs
   */
  GetLineIDsWithType(modelID: number, type: number): Vector<number> {
    const result = this.models.get(modelID)

    if (result === void 0) {

      Logger.error('[GetLineIDsWithType]: model === undefined')

      const vectorArray: Array<number> = []
      return {
        get(index: number): number {
          // Your implementation here
          if (index >= vectorArray.length) {
            return -1
          }

          return vectorArray[index]
        },
        size(): number {
          // Your implementation here
          return vectorArray.length
        },

        push(parameter: number): void {
          vectorArray.push(parameter)
        },
      }
    }

    return result.getLineIDsWithType(type)
  }

  /**
   *
   * @param modelID
   * @return {Vector<number>}
   */
  GetAllLines(modelID: number): Vector<number> {

    const result = this.models.get(modelID)

    if (result === void 0) {

      Logger.error('[GetAllLines]: model === undefined')

      const vectorArray: Array<number> = []
      return {
        get(index: number): number {
          // Your implementation here
          if (index >= vectorArray.length) {
            return -1
          }

          return vectorArray[index]
        },
        size(): number {
          // Your implementation here
          return vectorArray.length
        },

        push(parameter: number): void {
          vectorArray.push(parameter)
        },
      }
    }

    return result.getAllLines()
  }

  /**
   *
   * @param modelID
   * @param transformationMatrix
   */
  setGeometryTransformation(modelID: number, transformationMatrix: Array<number>) {
    /* if (transformationMatrix.length != 16) {
            Logger.error(`Bad transformation matrix size: ${transformationMatrix.length}`)
            return
        }
        this.wasmModule.setGeometryTransformation(modelID, transformationMatrix)*/

    Logger.warning('[setGeometryTransformation]: Shim - Unimplemented')
  }

  /**
   *
   * @param modelID
   * @return {Array<number>}
   */
  GetCoordinationMatrix(modelID: number): Array<number> {

    const result = this.models.get(modelID)

    if (result !== void 0) {

      return result.getCoordinationMatrix()
    }

    const coordinationMatrix: glmatrix.mat4 = glmatrix.mat4.create()

    return Array.from(coordinationMatrix)
  }

  /**
   *
   * @param ptr
   * @param size
   * @return {Float32Array}
   */
  GetVertexArray(ptr: number, size: number): Float32Array {
    return this.getSubArray(this.wasmModule.HEAPF32, ptr, size) as Float32Array
  }

  /**
   *
   * @param ptr
   * @param size
   * @return {Uint32Array}
   */
  GetIndexArray(ptr: number, size: number): Uint32Array {
    return this.getSubArray(this.wasmModule.HEAPU32, ptr, size) as Uint32Array
  }

  /**
   *
   * @param heap
   * @param startPtr
   * @param sizeBytes
   * @return {Float32Array | Uint32Array}
   */
  getSubArray(heap: Float32Array | Uint32Array, startPtr: number, sizeBytes: number):
    Float32Array | Uint32Array {
    // eslint-disable-next-line no-magic-numbers, no-mixed-operators
    return heap.subarray(startPtr / 4, startPtr / 4 + sizeBytes).slice(0)
  }

  /**
   * Closes a model and frees all related memory
   *
   * @param modelID Model handle retrieved by OpenModel, model must not be closed
   */
  CloseModel(modelID: number) {
    this.models.delete(modelID)
  }

  /**
   *
   * @param modelID
   * @param meshCallback
   */
  StreamAllMeshes(modelID: number, meshCallback: (mesh: FlatMesh) => void): void {
    const result = this.models.get(modelID)

    if (result !== void 0) {

      result.streamAllMeshes(meshCallback)
    }

    Logger.displayLogs()
    Logger.clearLogs()
    Logger.printStatistics(modelID)
  }


  /**
   *
   * @param modelID
   * @param types
   * @param meshCallback
   */
  StreamAllMeshesWithTypes(modelID: number,
      types: Array<number>,
      meshCallback: (mesh: FlatMesh) => void): void {
    const result = this.models.get(modelID)

    if (result !== void 0) {

      result.streamAllMeshesWithTypes(types, meshCallback)
    }
  }

  /**
   * Checks if a specific model ID is open or closed
   *
   * @param modelID handle retrieved by OpenModel
   * @return {boolean}
   */
  IsModelOpen(modelID: number): boolean {
    if (this.models.has(modelID)) {
      return true
    }

    return false
  }

  /**
   * Load all geometry in a model
   *
   * @param modelID handle retrieved by OpenModel
   * @return {Vector<FlatMesh>}
   */
  LoadAllGeometry(modelID: number): Vector<FlatMesh> {
    const result = this.models.get(modelID)

    if (result !== void 0) {

      return result.loadAllGeometry()
    }

    // dummy vars
    const dummyColor = {
      x: 0,
      y: 0,
      z: 0,
      w: 0,
    }

    // Single PlacedGeometry variable
    const singlePlacedGeometry: PlacedGeometry = {
      color: dummyColor,
      geometryExpressID: 0, // replace with actual ID
      flatTransformation: this.identity,
    }

    // eslint-disable-next-line no-array-constructor
    const placedGeometryArray = new Array<PlacedGeometry>()

    // Vector of PlacedGeometry
    const vectorOfPlacedGeometry: Vector<PlacedGeometry> = {
      get(index: number): PlacedGeometry {
        if (index >= placedGeometryArray.length) {
          return singlePlacedGeometry
        }

        return placedGeometryArray[index]
      },
      size(): number {
        return placedGeometryArray.length
      },
      push(parameter: PlacedGeometry): void {
        placedGeometryArray.push(parameter)
      },
    }

    // eslint-disable-next-line no-array-constructor
    const flatMeshArray = new Array<FlatMesh>()
    const flatMeshDummy: FlatMesh = {
      geometries: vectorOfPlacedGeometry,
      expressID: 0, // replace with actual expressID
    }

    // Vector of FlatMesh
    const vectorOfFlatMesh: Vector<FlatMesh> = {
      get(index: number): FlatMesh {
        if (index >= placedGeometryArray.length) {
          return flatMeshDummy
        }

        return flatMeshArray[index]
      },
      size(): number {
        // Your implementation here
        return flatMeshArray.length
      },
      push(parameter: FlatMesh): void {
        flatMeshArray.push(parameter)
      },
    }
    return vectorOfFlatMesh
  }

  /**
   * Load geometry for a single element
   *
   * @param modelID handle retrieved by OpenModel
   * @param expressID express ID of flat mesh
   * @return {FlatMesh}
   */
  GetFlatMesh(modelID: number, expressID: number): FlatMesh {
    const result = this.models.get(modelID)

    if (result !== void 0) {

      return result.getFlatMesh(expressID)
    }

    // Single PlacedGeometry variable
    const dummyColor = {
      x: 0,
      y: 0,
      z: 0,
      w: 0,
    }
    const singlePlacedGeometry: PlacedGeometry = {
      color: dummyColor,
      geometryExpressID: 0, // replace with actual ID
      flatTransformation: [/* your array of numbers here */],
    }

    // Vector of PlacedGeometry
    const vectorOfPlacedGeometry: Vector<PlacedGeometry> = {
      get(index: number): PlacedGeometry {
        // Your implementation here
        return singlePlacedGeometry // Dummy return, replace with actual implementation
      },
      size(): number {
        // Your implementation here
        return 1 // Dummy return, replace with actual implementation
      },
      push(): void {
        // eslint-disable-next-line no-useless-return
        return
      },
    }

    const flatMeshDummy: FlatMesh = {
      geometries: vectorOfPlacedGeometry,
      expressID: 0, // replace with actual expressID
    }

    return flatMeshDummy
  }

  /**
   * Creates a map between element ExpressIDs and GlobalIDs.
   * Each element has two entries, (ExpressID -> GlobalID) and (GlobalID -> ExpressID).
   *
   * @param modelID handle retrieved by OpenModel
   */
  CreateIfcGuidToExpressIdMapping(modelID: number): void {
    /* const map = new Map<string | number, string | number>()

        for (let x = 0; x < IfcElements.length; x++) {

            const type = IfcElements[x]
            const lines = this.GetLineIDsWithType(modelID, type)
            const size = lines.size()

            for (let y = 0; y < size; y++) {

                const expressID = lines.get(y)
                const info = this.GetLine(modelID, expressID)
                const globalID = info.GlobalId.value

                map.set(expressID, globalID)
                map.set(globalID, expressID)
            }
        }

        this.ifcGuidMap.push(modelID, map)*/

    Logger.warning(`[CreateIfcGuidToExpressIdMapping]: Model ${modelID}: Shim - Unimplemented`)
  }

  /**
   *
   * @param path new wasm path
   * @param absolute is the path absolute?
   */
  SetWasmPath(path: string, absolute = false) {
    this.wasmPath = path
    this.isWasmPathAbsolute = absolute
  }

  // Non web-ifc methods
  /** The conway version string like "0.23.940-WebMT" */
  getConwayVersion(): string {
    return versionString
  }  

  /** @see https://bldrs-ai.github.io/conway/classes/statistics_statistics.Statistics.html */
  getStatistics(modelID: number): any {
    return Logger.getStatistics(modelID)
  }  
}
