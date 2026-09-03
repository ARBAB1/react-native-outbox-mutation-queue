/**
 * Expo example — a note editor that keeps working with the network off.
 *
 * Toggle airplane mode (or the Offline switch below) and keep typing: edits
 * collapse into a single queued task and flush when connectivity returns.
 *
 * See example/README.md for setup.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createQueue } from 'react-native-outbox-mutation-queue';
import { useOfflineQueue } from 'react-native-outbox-mutation-queue/react';

type NotePayload = { id: string; text: string };

/** Stands in for a real API: slow, and fails ~30% of the time. */
async function fakeApi(payload: NotePayload): Promise<void> {
  await new Promise((r) => setTimeout(r, 600));
  if (Math.random() < 0.3) throw new Error('HTTP 503 upstream unavailable');
  console.log('[api] saved', payload);
}

export default function App() {
  const [text, setText] = useState('');
  const [offline, setOffline] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const append = (line: string) =>
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 30));

  const queue = useMemo(
    () =>
      createQueue<NotePayload>({
        storage: AsyncStorage,
        retry: { maxAttempts: 5, baseDelayMs: 800, maxDelayMs: 10_000, jitter: 0.3 },
        execute: (task) => fakeApi(task.payload),
        classifyError: (error) => {
          const status = Number(String(error).match(/HTTP (\d+)/)?.[1]);
          return status >= 400 && status < 500 ? 'permanent' : 'transient';
        },
        onDiscard: (task) => append(`⛔ gave up on "${task.payload.text}"`),
      }),
    [],
  );

  // Wire the switch to the queue. In a real app this is a NetInfo listener.
  const synced = useRef(false);
  if (!synced.current) {
    synced.current = true;
    queue.on('succeeded', (t) => append(`✅ synced "${t.payload.text}"`));
    queue.on('failed', (t, _e, willRetry) =>
      append(`↻ attempt ${t.attempts} failed${willRetry ? ' — retrying' : ''}`),
    );
  }

  const { pending, isOnline } = useOfflineQueue(queue);

  const toggleOffline = (next: boolean) => {
    setOffline(next);
    queue.setOnline(!next);
    append(next ? '📴 went offline' : '📶 back online');
  };

  const save = () => {
    if (!text.trim()) return;
    // One dedupeKey per note: rapid saves collapse to the latest text.
    void queue.enqueue('saveNote', { id: 'note-1', text }, { dedupeKey: 'note-1' });
    append(`📝 queued "${text}"`);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Offline Queue Demo</Text>

      <View style={styles.row}>
        <Text style={styles.label}>Simulate offline</Text>
        <Switch value={offline} onValueChange={toggleOffline} />
      </View>

      <View style={[styles.banner, isOnline ? styles.online : styles.offline]}>
        <Text style={styles.bannerText}>
          {isOnline ? 'Online' : 'Offline'}
          {pending > 0 ? ` · ${pending} change${pending === 1 ? '' : 's'} waiting` : ' · all synced'}
        </Text>
      </View>

      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Type a note…"
        multiline
      />

      <TouchableOpacity style={styles.button} onPress={save}>
        <Text style={styles.buttonText}>Save</Text>
      </TouchableOpacity>

      <Text style={styles.label}>Activity</Text>
      <ScrollView style={styles.log}>
        {log.map((line, i) => (
          <Text key={i} style={styles.logLine}>
            {line}
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, backgroundColor: '#fff', gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 14, color: '#555', fontWeight: '600' },
  banner: { padding: 12, borderRadius: 8 },
  online: { backgroundColor: '#e6f4ea' },
  offline: { backgroundColor: '#fdecea' },
  bannerText: { fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  button: { backgroundColor: '#1f3864', padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
  log: { flex: 1, borderWidth: 1, borderColor: '#eee', borderRadius: 8, padding: 8 },
  logLine: { fontSize: 12, color: '#444', marginBottom: 4, fontFamily: 'Menlo' },
});
