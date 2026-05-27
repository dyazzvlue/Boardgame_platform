<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { marked } from 'marked'

const route = useRoute()
const router = useRouter()
const isEdit = computed(() => !!route.params.id)

const form = ref({ title: '', slug: '', content: '', cover_image: '', category_id: null, published: false, pinned: false, tag_ids: [] })
const categories = ref([])
const tags = ref([])
const saving = ref(false)
const showPreview = ref(false)

onMounted(async () => {
  const [catRes, tagRes] = await Promise.all([
    fetch('/api/blog/categories'),
    fetch('/api/blog/tags'),
  ])
  categories.value = await catRes.json()
  tags.value = await tagRes.json()

  if (isEdit.value) {
    const res = await fetch(`/api/admin/posts/${route.params.id}`)
    if (res.ok) {
      const post = await res.json()
      form.value = { ...post, tag_ids: post.tags.map(t => t.id) }
    }
  }
})

async function save() {
  saving.value = true
  const url = isEdit.value ? `/api/admin/posts/${route.params.id}` : '/api/admin/posts'
  const method = isEdit.value ? 'PUT' : 'POST'
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form.value),
  })
  saving.value = false
  if (res.ok) router.push('/admin/posts')
  else alert((await res.json()).detail || '保存失败')
}

async function uploadImage(e) {
  const file = e.target.files[0]
  if (!file) return
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/admin/upload', { method: 'POST', body: fd })
  if (res.ok) {
    const data = await res.json()
    form.value.content += `\n![${file.name}](${data.url})\n`
  }
}
</script>

<template>
  <div class="editor-page">
    <div class="editor-header">
      <h2>{{ isEdit ? '编辑文章' : '新建文章' }}</h2>
      <div class="editor-actions">
        <button @click="showPreview = !showPreview">{{ showPreview ? '编辑' : '预览' }}</button>
        <button class="btn-primary" @click="save" :disabled="saving">{{ saving ? '保存中...' : '保存' }}</button>
      </div>
    </div>
    <div class="editor-body">
      <div class="form-side">
        <div class="field"><label>标题</label><input v-model="form.title"></div>
        <div class="field"><label>Slug</label><input v-model="form.slug" placeholder="留空自动生成"></div>
        <div class="field">
          <label>分类</label>
          <select v-model="form.category_id">
            <option :value="null">无分类</option>
            <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
          </select>
        </div>
        <div class="field">
          <label>标签</label>
          <div class="tag-select">
            <label v-for="tag in tags" :key="tag.id" class="tag-opt">
              <input type="checkbox" :value="tag.id" v-model="form.tag_ids"> {{ tag.name }}
            </label>
          </div>
        </div>
        <div class="field">
          <label>封面图</label>
          <input v-model="form.cover_image" placeholder="URL 或上传后自动填入">
        </div>
        <div class="field">
          <label>插入图片</label>
          <input type="file" accept="image/*" @change="uploadImage">
        </div>
        <div class="field">
          <label><input type="checkbox" v-model="form.published"> 立即发布</label>
        </div>
        <div class="field">
          <label><input type="checkbox" v-model="form.pinned"> 📌 置顶</label>
        </div>
      </div>
      <div class="content-side">
        <textarea v-if="!showPreview" v-model="form.content" class="editor-textarea" placeholder="Markdown 正文..."></textarea>
        <div v-else class="preview post-content" v-html="marked(form.content || '')"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
.editor-actions { display: flex; gap: 0.5rem; }
.editor-body { display: grid; grid-template-columns: 280px 1fr; gap: 1.5rem; }
.form-side .field { margin-bottom: 1rem; }
.form-side label { display: block; margin-bottom: 0.3rem; font-size: 0.85rem; color: var(--text-muted); }
.tag-select { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.tag-opt { display: flex; align-items: center; gap: 0.3rem; font-size: 0.85rem; }
.editor-textarea { width: 100%; min-height: 500px; resize: vertical; font-family: monospace; font-size: 0.9rem; }
.preview { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.5rem; min-height: 500px; overflow-y: auto; }
@media (max-width: 768px) { .editor-body { grid-template-columns: 1fr; } }
</style>
