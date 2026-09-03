import { useEffect, useState } from 'react';
import type { OfflineQueue } from './queue';
import type { Task } from './types';

export interface QueueState<P = unknown> {
  tasks: Task<P>[];
  pending: number;
  isOnline: boolean;
}

/**
 * Subscribe a component to queue contents.
 *
 * ```tsx
 * const { pending, isOnline } = useOfflineQueue(queue);
 * if (pending > 0) return <Text>{pending} change(s) waiting to sync</Text>;
 * ```
 */
export function useOfflineQueue<P = unknown>(
  queue: OfflineQueue<P>,
): QueueState<P> {
  const [tasks, setTasks] = useState<Task<P>[]>(() => queue.list());
  const [isOnline, setIsOnline] = useState<boolean>(() => queue.isOnline());

  useEffect(() => {
    setTasks(queue.list());
    setIsOnline(queue.isOnline());

    const unsubscribe = queue.on('changed', (next) => {
      setTasks(next);
      setIsOnline(queue.isOnline());
    });

    return unsubscribe;
  }, [queue]);

  return {
    tasks,
    pending: tasks.filter((t) => t.status !== 'discarded').length,
    isOnline,
  };
}
