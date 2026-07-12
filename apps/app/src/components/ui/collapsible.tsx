import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({ nativeButton = false, ...props }: CollapsiblePrimitive.Trigger.Props) {
  // Default to `nativeButton={false}` because callers in this codebase use the
  // Base UI `render` prop to compose the trigger with a non-<button> element
  // (e.g. SidebarMenuSubButton, ContextMenuTrigger). When `nativeButton` is
  // true (the Base UI default) but the rendered element is not a real
  // <button>, Base UI logs a noisy a11y warning on every render.
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      nativeButton={nativeButton}
      {...props}
    />
  )
}

function CollapsibleContent({ ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
