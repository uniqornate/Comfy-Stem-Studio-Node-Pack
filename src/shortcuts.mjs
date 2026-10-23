// Keys are written as "Ctrl+Z / Ctrl+Y": " / " separates alternatives and "+" joins the keys of one combination.
export const SHORTCUTS = [
  ['Playback', [['Space', 'Play or pause'], ['Ctrl+Enter', 'Run the selected model'], ['Shift+Drag', 'Loop a range'], ['Tab', 'Switch between normal and arrange view'], ['Alt+Knob', 'Resize every channel row']]],
  ['Channels', [['Click', 'Select a channel'], ['Ctrl+Click / Shift+Click', 'Add to or extend the selection'], ['Delete', 'Delete selected channels'], ['Ctrl+Knob', 'Pan a channel left or right'], ['Ctrl+G', 'Group the selected channels'], ['Double-click name / Ctrl+R', 'Rename a channel'], ['Right-click', 'Channel menu'], ['Ctrl+Click S', 'Solo several channels']]],
  ['Clips', [['Drag header', 'Move a clip'], ['Alt+Drag header', 'Copy a clip'], ['Ctrl+C / Ctrl+V', 'Copy a clip, paste at the playhead'], ['Ctrl+B', 'Split at the playhead'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo']]],
  ['Brush', [['B', 'Turn brush on or off'], ['Drag', 'Choose a region to paint'], ['Alt+Click', 'Brush the whole timeline (shows a new channel)'], ['Esc', 'Leave brush mode']]],
  ['Timeline', [['Middle-drag', 'Pan the timeline'], ['Right-click a take', 'Close it'], ['Ctrl+Wheel', 'Scroll the take tabs']]],
  ['General', [['F11', 'Full screen'], ['?', 'Show this list'], ['Esc', 'Close a dialog']]],
];
