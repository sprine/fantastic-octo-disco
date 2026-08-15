import { describe, expect, it } from 'vitest'
import { captureTime, exifFacts, readExif } from '../../src/main/ingest/exif.js'

// The parser's output shape, hand-built: these tests exercise the tag rules,
// not the byte-level parser.
const exif = (partial: object) => exifFacts(partial as never)

describe('captureTime', () => {
  it('prefers EXIF, then mtime, then import time', () => {
    expect(captureTime(111, 222, 333)).toEqual({ at: 111, source: 'exif' })
    expect(captureTime(null, 222, 333)).toEqual({ at: 222, source: 'mtime' })
    expect(captureTime(null, null, 333)).toEqual({ at: 333, source: 'import' })
  })

  it('treats a zero or negative mtime as a filesystem that has forgotten', () => {
    expect(captureTime(null, 0, 333)).toEqual({ at: 333, source: 'import' })
    expect(captureTime(null, -5, 333)).toEqual({ at: 333, source: 'import' })
  })
})

describe('coordinates', () => {
  it('combines degrees, minutes and seconds, signed by hemisphere', () => {
    const { fields } = exif({
      GPSInfo: {
        GPSLatitude: [33, 51, 36],
        GPSLatitudeRef: 'S',
        GPSLongitude: [151, 12, 0],
        GPSLongitudeRef: 'E'
      }
    })
    expect(fields.latitude).toBeCloseTo(-33.86, 2)
    expect(fields.longitude).toBeCloseTo(151.2, 2)
  })

  it('drops a fix with no hemisphere: a defaulted one would relocate the photo', () => {
    const { fields } = exif({
      GPSInfo: { GPSLatitude: [10, 0, 0], GPSLongitude: [20, 0, 0], GPSLongitudeRef: 'E' }
    })
    expect(fields.latitude).toBeUndefined()
    expect(fields.longitude).toBeUndefined()
  })

  it('writes both coordinates or neither', () => {
    const { fields } = exif({
      GPSInfo: { GPSLatitude: [10, 0, 0], GPSLatitudeRef: 'N' }
    })
    expect(fields.latitude).toBeUndefined()
  })

  it('drops an out-of-range coordinate as a rig writing rubbish', () => {
    const { fields } = exif({
      GPSInfo: {
        GPSLatitude: [95, 0, 0],
        GPSLatitudeRef: 'N',
        GPSLongitude: [10, 0, 0],
        GPSLongitudeRef: 'E'
      }
    })
    expect(fields.latitude).toBeUndefined()
  })
})

describe('altitude', () => {
  it('reads GPSAltitudeRef 1 as below sea level', () => {
    expect(exif({ GPSInfo: { GPSAltitude: 42.5, GPSAltitudeRef: 1 } }).fields.altitudeMetres).toBe(-42.5)
  })

  it('keeps an ordinary altitude positive and a signed one as written', () => {
    expect(exif({ GPSInfo: { GPSAltitude: 120, GPSAltitudeRef: 0 } }).fields.altitudeMetres).toBe(120)
    expect(exif({ GPSInfo: { GPSAltitude: -3, GPSAltitudeRef: 0 } }).fields.altitudeMetres).toBe(-3)
  })

  it('drops an absurd magnitude', () => {
    expect(exif({ GPSInfo: { GPSAltitude: 4e9, GPSAltitudeRef: 0 } }).fields.altitudeMetres).toBeUndefined()
  })
})

describe('resolution', () => {
  it('reads inches directly and converts centimetres', () => {
    expect(exif({ Image: { XResolution: 300, ResolutionUnit: 2 } }).fields.dpi).toBe(300)
    expect(exif({ Image: { XResolution: 118, ResolutionUnit: 3 } }).fields.dpi).toBe(300)
  })

  it('ignores unit 1, which declares an aspect ratio rather than a density', () => {
    expect(exif({ Image: { XResolution: 300, ResolutionUnit: 1 } }).fields.dpi).toBeUndefined()
  })

  it('drops zero, negative and absurd values', () => {
    expect(exif({ Image: { XResolution: 0, ResolutionUnit: 2 } }).fields.dpi).toBeUndefined()
    expect(exif({ Image: { XResolution: 4e9, ResolutionUnit: 2 } }).fields.dpi).toBeUndefined()
  })
})

describe('camera facts', () => {
  it('reads make, model, lens and the exposure numbers', () => {
    const { fields } = exif({
      Image: { Make: 'Canon', Model: 'Canon EOS 5D' },
      Photo: {
        LensModel: 'EF 24-70mm f/2.8L',
        ExposureTime: 0.004,
        FNumber: 2.8,
        ISOSpeedRatings: 400,
        FocalLength: 35
      }
    })
    expect(fields).toMatchObject({
      make: 'Canon',
      model: 'Canon EOS 5D',
      lens: 'EF 24-70mm f/2.8L',
      exposureSeconds: 0.004,
      fNumber: 2.8,
      iso: 400,
      focalLengthMm: 35
    })
  })

  it('takes the first ISO when the tag holds a list', () => {
    expect(exif({ Photo: { ISOSpeedRatings: [200, 0] } }).fields.iso).toBe(200)
  })

  it('trims padded strings and drops empty ones', () => {
    const { fields } = exif({ Image: { Make: '  NIKON\0\0 ', Model: '   ' } })
    expect(fields.make).toBe('NIKON')
    expect(fields.model).toBeUndefined()
  })

  it('drops zero, negative and absurd camera numbers', () => {
    const { fields } = exif({
      Photo: { ExposureTime: 0, FNumber: -1, ISOSpeedRatings: 4e9, FocalLength: 4e9 }
    })
    expect(fields.exposureSeconds).toBeUndefined()
    expect(fields.fNumber).toBeUndefined()
    expect(fields.iso).toBeUndefined()
    expect(fields.focalLengthMm).toBeUndefined()
  })
})

describe('capture timestamp', () => {
  it('reads DateTimeOriginal as an instant', () => {
    const when = new Date('2024-05-01T10:00:00Z')
    expect(exif({ Photo: { DateTimeOriginal: when } }).capturedAt).toBe(when.getTime())
  })

  it('answers null for an absent or invalid date', () => {
    expect(exif({}).capturedAt).toBeNull()
    expect(exif({ Photo: { DateTimeOriginal: new Date('nonsense') } }).capturedAt).toBeNull()
  })
})

describe('readExif', () => {
  it('answers nothing for an absent or malformed block rather than failing the import', () => {
    expect(readExif(undefined)).toEqual({ capturedAt: null, fields: {} })
    expect(readExif(Buffer.from('not an exif block'))).toEqual({ capturedAt: null, fields: {} })
  })
})
