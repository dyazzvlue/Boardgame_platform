<script setup>
import { ref, onUnmounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { renderMarkdown } from '@/lib/markdown.js'
import { requestJson, createRequestScope, expectArray, errorMessage, isAbortError } from '@/lib/http.js'

const route = useRoute()
const router = useRouter()
const isEdit = computed(() => !!route.params.id)

const emptyForm = () => ({ title: '', slug: '', content: '', cover_image: '', category_id: null, published: false, pinned: false, tag_ids: [] })
const form = ref(emptyForm())
const categories = ref([])
const tags = ref([])
const saving = ref(false)
const showPreview = ref(false)
const loading = ref(true)
const loaded = ref(false)
const uploading = ref(false)
const loadError = ref('')
const saveError = ref('')
const uploadError = ref('')
const readScope = createRequestScope()
const saveScope = createRequestScope()
const uploadScope = createRequestScope()

async function loadEditor() {
  const current = readScope.begin()
  loading.value = true
  loadError.value = ''
  try {
    const [cats, allTags, post] = await Promise.all([
      requestJson('/api/blog/categories', { signal: current.signal }),
      requestJson('/api/blog/tags', { signal: current.signal }),
      isEdit.value ? requestJson(`/api/admin/posts/${encodeURIComponent(route.params.id)}`, { signal: current.signal }) : null,
    ])
    expectArray(cats)
    expectArray(allTags)
    if (isEdit.value && (!post || typeof post.title !== 'string' || typeof post.content !== 'string' || !Array.isArray(post.tags))) {
      throw new Error('文章数据格式不正确，不能编辑，请重试')
    }
    if (!current.isCurrent()) return
    categories.value = cats
    tags.value = allTags
    if (post) {
      form.value = { ...post, tag_ids: post.tags.map(t => t.id) }
    }
    loaded.value = true
  } catch (failure) {
    if (current.isCurrent() && !isAbortError(failure)) loadError.value = errorMessage(failure)
  } finally {
    if (current.isCurrent()) loading.value = false
  }
}

async function save() {
  if (saving.value || uploading.value || loading.value || !loaded.value) return false
  const current = saveScope.begin()
  saving.value = true
  saveError.value = ''
  const url = isEdit.value ? `/api/admin/posts/${encodeURIComponent(route.params.id)}` : '/api/admin/posts'
  const method = isEdit.value ? 'PUT' : 'POST'
  try {
    await requestJson(url, { method, json: form.value, signal: current.signal })
    if (!current.isCurrent()) return false
    router.push('/admin/posts')
    return true
  } catch (failure) {
    if (current.isCurrent() && !isAbortError(failure)) saveError.value = errorMessage(failure)
    return false
  } finally {
    if (current.isCurrent()) saving.value = false
  }
}

async function uploadImage(e) {
  const input = e.target
  const file = input.files[0]
  if (!file || uploading.value || saving.value || loading.value || !loaded.value) return false
  const current = uploadScope.begin()
  uploading.value = true
  uploadError.value = ''
  const fd = new FormData()
  fd.append('file', file)
  try {
    const data = await requestJson('/api/admin/upload', { method: 'POST', body: fd, signal: current.signal })
    if (!data || typeof data.url !== 'string' || !data.url) throw new Error('服务器未返回图片地址，请重试上传')
    if (!current.isCurrent()) return false
    const alt = file.name.replace(/[\r\n]/g, ' ').replace(/[\[\]\\]/g, '\\$&')
    form.value.content += `\n![${alt}](${data.url})\n`
    return true
  } catch (failure) {
    if (current.isCurrent() && !isAbortError(failure)) uploadError.value = errorMessage(failure)
    return false
  } finally {
    if (current.isCurrent()) {
      uploading.value = false
      input.value = ''
    }
  }
}

watch(() => route.params.id, () => {
  saveScope.cancel()
  uploadScope.cancel()
  form.value = emptyForm()
  loaded.value = false
  saving.value = uploading.value = false
  saveError.value = uploadError.value = ''
  showPreview.value = false
  loadEditor()
}, { immediate: true })

onUnmounted(() => { readScope.cancel(); saveScope.cancel(); uploadScope.cancel() })
</script>

<template>
  <div class="editor-page">
    <div class="editor-header">
      <h2>{{ isEdit ? '编辑文章' : '新建文章' }}</h2>
      <div class="editor-actions">
        <button @click="showPreview = !showPreview" :disabled="loading || !loaded">{{ showPreview ? '编辑' : '预览' }}</button>
        <button class="btn-primary" @click="save" :disabled="saving || uploading || loading || !loaded">{{ saving ? '保存中...' : '保存' }}</button>
      </div>
    </div>
    <p v-if="saveError" class="request-error" role="alert">{{ saveError }}；内容已保留，请重试保存。</p>
    <p v-if="uploadError" class="request-error" role="alert">{{ uploadError }}；请重新选择图片重试。</p>
    <p v-if="uploading" role="status">正在上传图片…</p>
    <p v-if="loading" role="status">正在加载编辑器…</p>
    <div v-else-if="loadError" class="request-error" role="alert">
      <p>{{ loadError }}</p>
      <button @click="loadEditor">重新加载编辑器</button>
    </div>
    <fieldset v-else-if="loaded" class="editor-body" :disabled="saving || uploading">
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
        <div v-else class="preview post-content" v-html="renderMarkdown(form.content)"></div>
      </div>
    </fieldset>
  </div>
</template>

<style scoped>
.editor-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
.editor-actions { display: flex; gap: 0.5rem; }
.editor-body { display: grid; grid-template-columns: 280px 1fr; gap: 1.5rem; border: 0; padding: 0; min-width: 0; }
.request-error { color: var(--danger); margin-bottom: 1rem; }
.form-side .field { margin-bottom: 1rem; }
.form-side label { display: block; margin-bottom: 0.3rem; font-size: 0.85rem; color: var(--text-muted); }
.tag-select { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.tag-opt { display: flex; align-items: center; gap: 0.3rem; font-size: 0.85rem; }
.editor-textarea { width: 100%; min-height: 500px; resize: vertical; font-family: monospace; font-size: 0.9rem; }
.preview { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.5rem; min-height: 500px; overflow-y: auto; }
@media (max-width: 768px) { .editor-body { grid-template-columns: 1fr; } }
</style>
