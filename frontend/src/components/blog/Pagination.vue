<script setup>
import { computed } from 'vue'
const props = defineProps({ total: Number, page: Number, size: Number })
const emit = defineEmits(['change'])

const totalPages = computed(() => Math.ceil(props.total / props.size))
</script>

<template>
  <div v-if="totalPages > 1" class="pagination">
    <button :disabled="page <= 1" @click="emit('change', page - 1)">上一页</button>
    <span class="info">{{ page }} / {{ totalPages }}</span>
    <button :disabled="page >= totalPages" @click="emit('change', page + 1)">下一页</button>
  </div>
</template>

<style scoped>
.pagination { display: flex; justify-content: center; align-items: center; gap: 1rem; margin-top: 2rem; }
.pagination button { background: var(--bg-card); border: 1px solid var(--border); color: var(--text); padding: 0.4rem 1rem; }
.pagination button:disabled { opacity: 0.4; cursor: not-allowed; }
.info { color: var(--text-muted); }
</style>
