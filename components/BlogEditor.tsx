'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useState } from 'react'

export default function BlogEditor({ initialContent }: { initialContent: string }) {
  const [json, setJson] = useState(initialContent)

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialContent ? JSON.parse(initialContent) : '<p></p>',
    onUpdate: ({ editor }) => {
      setJson(JSON.stringify(editor.getJSON()))
    },
    immediatelyRender: false,
  })

  if (!editor) return null

  const btn = (active: boolean) => ({
    padding: '4px 10px',
    fontWeight: active ? ('bold' as const) : ('normal' as const),
    background: active ? '#333' : 'transparent',
    color: '#fff',
    border: '1px solid #444',
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, paddingBottom: 8 }}>
        <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} style={btn(editor.isActive('bold'))}>
          B
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} style={btn(editor.isActive('italic'))}>
          I
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} style={btn(editor.isActive('heading', { level: 2 }))}>
          H2
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} style={btn(editor.isActive('bulletList'))}>
          • List
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleBlockquote().run()} style={btn(editor.isActive('blockquote'))}>
          Quote
        </button>
      </div>
      <div style={{ border: '1px solid #333', padding: 12, minHeight: 300 }}>
        <EditorContent editor={editor} />
      </div>
      <input type="hidden" name="content" value={json} />
    </div>
  )
}
