import { applyPatches, type Patch } from "immer";
import { createStore } from "zustand/vanilla";
import { editRig, rigActorSchema, type RigActor, type RigCommand } from "./commands";
import { rigStateSchema, type KinetixRigState } from "./model";

type HistoryEntry = {
  label: string;
  actor: RigActor;
  forward: Patch[];
  inverse: Patch[];
};

type RigStore = {
  rig: KinetixRigState;
  past: HistoryEntry[];
  future: HistoryEntry[];
  dispatch: (label: string, actor: RigActor, ...commands: RigCommand[]) => void;
  undo: () => void;
  redo: () => void;
  reset: (rig: KinetixRigState) => void;
};

const historyLimit = 100;

export function createRigStore(initial: KinetixRigState) {
  return createStore<RigStore>()(set => ({
    rig: rigStateSchema.parse(initial),
    past: [],
    future: [],
    dispatch: (label, actor, ...commands) => set(state => {
      const by = rigActorSchema.parse(actor);
      const [rig, forward, inverse] = editRig(state.rig, commands);
      if (forward.length === 0) return state;
      const entry = { label, actor: by, forward, inverse };
      return { rig, past: [...state.past, entry].slice(-historyLimit), future: [] };
    }),
    undo: () => set(state => {
      const entry = state.past.at(-1);
      if (!entry) return state;
      return {
        rig: applyPatches(state.rig, entry.inverse),
        past: state.past.slice(0, -1),
        future: [...state.future, entry],
      };
    }),
    redo: () => set(state => {
      const entry = state.future.at(-1);
      if (!entry) return state;
      return {
        rig: applyPatches(state.rig, entry.forward),
        past: [...state.past, entry],
        future: state.future.slice(0, -1),
      };
    }),
    reset: rig => set({ rig: rigStateSchema.parse(rig), past: [], future: [] }),
  }));
}
