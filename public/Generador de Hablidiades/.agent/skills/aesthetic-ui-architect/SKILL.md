---
name: aesthetic-ui-architect
description: Guides the agent in creating premium, high-end web user interfaces using modern design principles like glassmorphism, harmonious HSL palettes, and fluid micro-animations.
---

# Aesthetic UI Architect

This skill provides a comprehensive framework for designing and implementing visually stunning web applications that "WOW" the user. It moves beyond basic layouts into high-production value interfaces.

## When to use this skill
- When starting a new web project that requires a premium look and feel.
- When the existing UI feels "generic" or "flat" and needs a modern upgrade.
- When you need to implement complex visual effects like glassmorphism, complex gradients, or advanced typography.

## How to use it

### 1. Establish the Design System
Define a harmonious color palette using HSL instead of hex codes for easier manipulation of shades and transparency.

### 2. Implement Glassmorphism
Apply backdrop filters and subtle borders to create a layered, modern feel.
```css
.glass-panel {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 16px;
}
```

### 3. Typography & Hierarchy
Use variable fonts (e.g., 'Inter' or 'Outfit') and maintain strict vertical rhythm.

### 4. Micro-animations
Add subtle hover effects and entry transitions to make the interface feel alive.
```css
.interactive-element {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.interactive-element:hover {
  transform: translateY(-2px) scale(1.02);
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
}
```
