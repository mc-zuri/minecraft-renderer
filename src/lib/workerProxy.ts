import { proxy, getVersion, subscribe } from 'valtio'
import { Vec3 } from 'vec3'

export function createWorkerProxy<T extends Record<string, (...args: any[]) => void | Promise<any>>> (handlers: T, channel?: MessagePort): { __workerProxy: T } {
  const target = channel ?? globalThis
  target.addEventListener('message', (event: any) => {
    const { type, args, msgId } = event.data
    if (handlers[type]) {
      const result = handlers[type](...args)
      if (result instanceof Promise) {
        void result.then((result) => {
          target.postMessage({
            type: 'result',
            msgId,
            args: [result]
          })
        })
      }
    }
  })
  return null as any
}

/**
 * in main thread
 * ```ts
 * // either:
 * import type { importedTypeWorkerProxy } from './worker'
 * // or:
 * type importedTypeWorkerProxy = import('./worker').importedTypeWorkerProxy
 *
 * const workerChannel = useWorkerProxy<typeof importedTypeWorkerProxy>(worker)
 * ```
 */
export const useWorkerProxy = <T extends { __workerProxy: Record<string, (...args: any[]) => void> }> (worker: Worker | MessagePort, autoTransfer = true): T['__workerProxy'] & {
  transfer: (...args: Transferable[]) => T['__workerProxy']
} => {
  let messageId = 0
  // in main thread
  return new Proxy({} as any, {
    get (target, prop) {
      if (prop === 'transfer') {
        return (...transferable: Transferable[]) => {
          return new Proxy({}, {
            get (target, prop) {
              return (...args: any[]) => {
                worker.postMessage({
                  type: prop,
                  args,
                }, transferable)
              }
            }
          })
        }
      }
      return (...args: any[]) => {
        const msgId = messageId++
        const transfer = autoTransfer ? args.filter(arg => {
          return arg instanceof ArrayBuffer || arg instanceof MessagePort
            || (typeof ImageBitmap !== 'undefined' && arg instanceof ImageBitmap)
            || (typeof OffscreenCanvas !== 'undefined' && arg instanceof OffscreenCanvas)
            || (typeof ImageData !== 'undefined' && arg instanceof ImageData)
        }) : []
        worker.postMessage({
          type: prop,
          msgId,
          args,
        }, transfer)
        return {
          // eslint-disable-next-line unicorn/no-thenable
          then (onfulfilled: (value: any) => void) {
            const handler = ({ data }: MessageEvent): void => {
              if (data.type === 'result' && data.msgId === msgId) {
                onfulfilled(data.args[0])
                worker.removeEventListener('message', handler as EventListener)
              }
            }
            worker.addEventListener('message', handler as EventListener)
          }
        }
      }
    }
  })
}

const DEBUG_SYNC = false

const sendWorkerSync = (syncId: string, obj: any, worker: Worker, debugKey: string) => {
  try {
    worker.postMessage({
      type: 'sync',
      syncId,
      value: cloneValtioObject(obj)
    })
    currentWorkerSyncStats.toWorker++
    globalThis.debugSyncMessagesOutgoing ??= 0
    globalThis.debugSyncMessagesOutgoing++
  } catch (err) {
    console.error('Failed to send worker sync', err)
    findProblemTransfer(obj)
  }
}

// Add stats tracking variables
const currentWorkerSyncStats = { toWorker: 0, fromWorker: 0 }

if (typeof window !== 'undefined') {
  setInterval(() => {
    window.debugWorkerSyncStats = { ...currentWorkerSyncStats }
    currentWorkerSyncStats.toWorker = 0
    currentWorkerSyncStats.fromWorker = 0
  }, 1000)
}

const getSyncId = () => {
  return Math.random().toString(36).slice(2, 15) + Math.random().toString(36).slice(2, 15)
}

const setupObjectSync = (obj: any, originalObj: any, worker: Worker, isValtio: boolean, debugKey: string) => {
  if (!obj['__syncToWorker'] && !obj['__syncFromWorker'] && !isValtio) return

  const syncId = getSyncId()
  obj['__syncId'] = syncId

  if (obj['__syncToWorker'] || isValtio) {
    const syncToWorker = () => {
      sendWorkerSync(syncId, originalObj, worker, `toWorker:${debugKey}`)
    }
    if (isValtio) {
      subscribe(originalObj, syncToWorker)
    }

    const interval = obj['__syncToWorkerInterval'] ?? 0
    if (interval > 0) {
      setInterval(syncToWorker, interval)
    }
  }

  if (originalObj['__syncFromWorker']) {
    worker.addEventListener('message', (event: any) => {
      if (event.data.type === 'sync' && event.data.syncId === syncId) {
        currentWorkerSyncStats.fromWorker++
        Object.assign(originalObj, event.data.value)
      }
    })
  }
}

const cloneValtioObject = (obj: any) => {
  if (getVersion(obj) === undefined) {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(cloneValtioObject)
  }

  if (typeof obj === 'object' && obj !== null) {
    const newObj = {} as any
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        newObj[key] = cloneValtioObject(obj[key])
      }
    }
    return newObj
  }

  return obj
}

export const deepPrepareForTransfer = (obj: any, worker: Worker, autoRemoveMethods = true, _isRoot = true, _isInsideValtio = false) => {
  const originalObj = obj
  const newObj = {} as any

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      if (autoRemoveMethods && typeof obj[key] === 'function') {
        continue
      }

      // print a warning for Date, RegExp, Map, WeakMap, WeakSet
      if (obj[key] instanceof Date || obj[key] instanceof RegExp || obj[key] instanceof Map || obj[key] instanceof WeakMap || obj[key] instanceof WeakSet) {
        console.warn(`Warning: ${key} is a ${typeof obj[key]}, which is not supported for transfer.`)
      }

      // default restorers main -> worker
      // Set (only primitive values)
      if (obj[key] instanceof Set) {
        newObj[key] = [...obj[key]]
        newObj[key]['__restorer'] = 'Set'
        continue
      }
      if (obj[key] instanceof Vec3) {
        newObj[key] = { x: obj[key].x, y: obj[key].y, z: obj[key].z }
        newObj[key]['__restorer'] = 'Vec3'
        continue
      }

      newObj[key] = obj[key]

      if (typeof obj[key] === 'object' && obj[key] !== null) {
        if (obj[key]['prepareForTransfer']) {
          newObj[key] = obj[key]['prepareForTransfer'](worker)
          continue
        }

        const isValtio = getVersion(obj[key]) !== undefined
        newObj[key] = isValtio ? cloneValtioObject(obj[key]) : obj[key]

        // Try to enable sync main -> worker
        const tryEnableDefaultSync = obj[key]['__syncToWorker'] !== false && !_isInsideValtio && isValtio && !obj[key]['__syncFromWorker']
        newObj[key]['__syncToWorker'] ??= tryEnableDefaultSync
        if (isValtio) {
          newObj[key]['__valtio'] ??= true
        }

        if (newObj[key]['__syncToWorker'] && isValtio) {
          setupObjectSync(newObj[key], originalObj[key], worker, true, key)
          continue
        }
        setupObjectSync(newObj[key], originalObj[key], worker, false, key)


        newObj[key] = deepPrepareForTransfer(newObj[key], worker, autoRemoveMethods, false, isValtio)
      }
    }
  }
  return newObj
}

export const findProblemTransfer = (obj: any, path: string[] = []) => {
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      if (!obj[key]) continue
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        findProblemTransfer(obj[key], [...path, key])
      }
      try {
        structuredClone(obj[key])
      } catch (error) {
        console.error(error)
        console.log('Failed to clone for transfer', path.join('.'))
      }
    }
  }
}

const receiveSyncedObject = (obj: any, worker: Worker, debugKey: string) => {
  if (!obj['__syncId']) return
  const syncId = obj['__syncId']

  if (obj['__syncToWorker']) {
    worker.addEventListener('message', (event: any) => {
      if (event.data.type === 'sync' && event.data.syncId === syncId) {
        Object.assign(obj, event.data.value)
      }
    })
  }

  if (obj['__syncFromWorker']) {
    const syncFromWorker = () => {
      sendWorkerSync(syncId, obj, worker, `fromWorker:${debugKey}`)
    }

    if (obj['__valtio']) {
      subscribe(obj, syncFromWorker)
    }

    const interval = obj['__syncFromWorkerInterval'] ?? 0
    if (interval > 0) {
      setInterval(syncFromWorker, interval)
    }
  }
}

const defaultRestorers = [
  {
    restorerName: 'Set',
    restoreTransferred (obj, worker: Worker) {
      return new Set(obj)
    }
  },
  {
    restorerName: 'Vec3',
    restoreTransferred (obj, worker: Worker) {
      return new Vec3(obj.x, obj.y, obj.z)
    }
  }
]

export const addDefaultRestorer = (restorer: { restorerName: string, restoreTransferred: (obj: any, worker: Worker) => any }) => {
  defaultRestorers.unshift(restorer)
}

export const restoreTransferred = (obj: any, restorersArg: any[], worker: Worker, errorHandler: ((error: Error) => void) | boolean = true) => {
  const restorers = [...defaultRestorers, ...restorersArg]

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      if (!obj[key]) continue

      if (typeof obj[key] === 'object' && obj[key] !== null) {
        restoreTransferred(obj[key], restorers, worker, errorHandler)
      }

      if (obj[key]['__restorer']) {
        // find restorer
        const restorer = restorers.find(restorer => {
          return restorer.restorerName ? restorer.restorerName === obj[key]['__restorer'] : restorer.name === obj[key]['__restorer']
        })
        if (restorer) {
          obj[key] = restorer.restoreTransferred(obj[key], worker)
        } else {
          const error = new Error(`Restorer ${obj[key]['__restorer']} not found`)
          if (typeof errorHandler === 'function') {
            errorHandler(error)
          } else if (errorHandler) {
            throw error
          } else {
            console.error(error)
          }
        }
      }

      if (obj[key]['__valtio']) {
        obj[key] = proxy(obj[key])
      }

      receiveSyncedObject(obj[key], worker, key)
    }
  }
  return obj
}

// const workerProxy = createWorkerProxy({
//     startRender (canvas: HTMLCanvasElement) {
//     },
// })

// const worker = useWorkerProxy(null, workerProxy)

// worker.
