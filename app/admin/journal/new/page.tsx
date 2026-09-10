import { createPost } from '@/app/actions/blog'

export default function NewPostPage() {
  return (
    <div style={{ padding: 40, maxWidth: 400 }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>New post</h1>
      <form action={createPost}>
        <input
          type="text"
          name="title"
          placeholder="Post title"
          required
          style={{ width: '100%', padding: 10, marginBottom: 12 }}
        />
        <button type="submit" style={{ padding: '8px 16px' }}>
          Create post
        </button>
      </form>
    </div>
  )
}
