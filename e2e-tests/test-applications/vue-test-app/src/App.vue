<script setup>
import { ref } from 'vue';

const count = ref(0);
</script>

<template>
  <main>
    <h1>Vue Test App</h1>
    <button type="button" @click="count++">Count is: {{ count }}</button>
  </main>
</template>
