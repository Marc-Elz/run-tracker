import { onBeforeUnmount, onMounted, onUpdated, watch, type Ref } from 'vue'
import Sortable from 'sortablejs'
import type { StepPlace } from '@/lib/training'

/**
 * Drag to reorder the step list of the session editor, with SortableJS.
 *
 * Every element with `data-step-list` under `root` is a list: `""` for the top level, or a
 * repeat's step id. Its direct `.step` children are the steps, dragged by their `.step__handle`.
 * All lists share one group, so a step can move into or out of a repeat; nested lists work
 * because the inner list gets the touch first and Sortable then ignores it in the outer one.
 *
 * Sortable moves the DOM itself. On a drop that move is undone straight away and `onDrop` gets
 * where the step came from and where it went, so the blocks model changes and Vue redraws the
 * list from it: Vue stays the only one deciding what the DOM looks like.
 */
export function useSortableSteps(
  root: Ref<HTMLElement | null>,
  options: {
    enabled: Ref<boolean>
    /** False refuses the drop target while dragging (shown by not making room there) */
    canMove: (from: StepPlace['list'], to: StepPlace['list'], isRepeat: boolean) => boolean
    onDrop: (from: StepPlace, to: StepPlace) => void
  },
) {
  const lists = new Map<HTMLElement, Sortable>()
  const listId = (el: HTMLElement) => el.dataset.stepList || null

  function create(el: HTMLElement) {
    return Sortable.create(el, {
      group: 'steps',
      draggable: '>.step',
      handle: '.step__handle',
      // A short press on the handle drags at once with a mouse; on touch it waits, so a swipe
      // over the list still scrolls
      delay: 250,
      delayOnTouchOnly: true,
      animation: 150,
      // Pointer events everywhere instead of HTML5 drag and drop: touch always works this way,
      // so a mouse drag in the browser test takes the same path as a finger on the phone
      forceFallback: true,
      fallbackOnBody: true,
      swapThreshold: 0.65,
      disabled: !options.enabled.value,
      onMove: (evt) =>
        options.canMove(
          listId(evt.from),
          listId(evt.to),
          (evt.dragged as HTMLElement).dataset.repeat !== undefined,
        ),
      onEnd: (evt) => {
        const { item, from, to, oldIndex, newIndex } = evt
        if (oldIndex === undefined || newIndex === undefined) return
        if (from === to && oldIndex === newIndex) return
        // Undo Sortable's move: with the item out, the old list is as it was minus the item
        item.remove()
        from.insertBefore(item, from.children[oldIndex] ?? null)
        options.onDrop(
          { list: listId(from), index: oldIndex },
          { list: listId(to), index: newIndex },
        )
      },
    })
  }

  /** Lists come and go with the repeats in them: keep one Sortable per list on screen */
  function sync() {
    const el = root.value
    const found = new Set<HTMLElement>(
      el ? Array.from(el.querySelectorAll<HTMLElement>('[data-step-list]')) : [],
    )
    for (const [list, sortable] of lists) {
      if (!found.has(list)) {
        sortable.destroy()
        lists.delete(list)
      }
    }
    for (const list of found) {
      if (!lists.has(list)) lists.set(list, create(list))
    }
  }

  watch(options.enabled, (on) => {
    for (const sortable of lists.values()) sortable.option('disabled', !on)
  })
  onMounted(sync)
  onUpdated(sync)
  onBeforeUnmount(() => {
    for (const sortable of lists.values()) sortable.destroy()
    lists.clear()
  })
}
