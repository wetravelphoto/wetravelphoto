'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { registerPhoto } from '@/app/actions/photos'

type Job = {
  name: string
  progress: number
  status: 'waiting' | 'uploading' | 'processing' | 'done' | 'failed'
  message?: string
}

/**
 * Files go straight from the browser to storage using a short-lived signed
 * URL, then the server is asked to process what landed. Nothing large passes
 * through the server, so there's no request size limit to run into.
 */
export default function PhotoUploader({ albumId }: { albumId: string }) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  function update(index: number, patch: Partial<Job>) {
    setJobs((prev) => prev.map((job, i) => (i === index ? { ...job, ...patch } : job)))
  }

  /** XHR rather than fetch — it's the only way to get upload progress. */
  function put(url: string, file: File, onProgress: (percent: number) => void) {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', url)
      xhr.setRequestHeader('Content-Type', file.type)

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
      }

      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`Storage rejected the file (${xhr.status})`))

      xhr.onerror = () => reject(new Error('Network error during upload'))
      xhr.send(file)
    })
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return

    const list = Array.from(files)
    setJobs(list.map((f) => ({ name: f.name, progress: 0, status: 'waiting' as const })))
    setBusy(true)

    for (const [index, file] of list.entries()) {
      try {
        update(index, { status: 'uploading' })

        const response = await fetch('/api/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ albumId, contentType: file.type }),
        })

        const signed = await response.json()
        if (!response.ok) throw new Error(signed.error ?? 'Could not start the upload')

        await put(signed.url, file, (percent) => update(index, { progress: percent }))

        // Derivatives are built server-side from the stored original
        update(index, { status: 'processing', progress: 100 })
        await registerPhoto(albumId, signed.key, signed.base, file.size)

        update(index, { status: 'done' })
      } catch (error) {
        update(index, {
          status: 'failed',
          message: error instanceof Error ? error.message : 'Upload failed',
        })
      }
    }

    setBusy(false)
    router.refresh()

    // Clear the finished list shortly after, keeping any failures on screen
    setTimeout(() => {
      setJobs((prev) => prev.filter((job) => job.status === 'failed'))
    }, 2500)
  }

  const finished = jobs.filter((j) => j.status === 'done').length

  return (
    <div>
      <div
        className="uploader"
        data-dragging={dragging}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
        onClick={() => !busy && fileRef.current?.click()}
      >
        <p className="uploader-title">{busy ? 'Uploading…' : 'Drop photographs here'}</p>
        <p className="admin-meta" style={{ margin: 0 }}>
          {busy
            ? `${finished} of ${jobs.length} complete`
            : 'Or click to choose files. Originals are kept at full resolution.'}
        </p>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/tiff,image/avif"
        multiple
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />

      {jobs.length > 0 && (
        <ul className="upload-list">
          {jobs.map((job, i) => (
            <li key={`${job.name}-${i}`} data-status={job.status}>
              <span className="upload-name">{job.name}</span>

              <span className="upload-track">
                <span
                  className="upload-fill"
                  style={{ width: `${job.status === 'processing' ? 100 : job.progress}%` }}
                />
              </span>

              <span className="upload-status">
                {job.status === 'waiting' && 'Waiting'}
                {job.status === 'uploading' && `${job.progress}%`}
                {job.status === 'processing' && 'Processing'}
                {job.status === 'done' && 'Done'}
                {job.status === 'failed' && (job.message ?? 'Failed')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
