# Interactive HTML in chat

Use an `html` code fence for a self-contained interactive preview. Put CSS and JavaScript inline. The preview blocks external assets, network requests, forms, popups, and access to the desktop bridge. Its state resets when the preview reloads.

The user can describe a choice or requested changes in the feedback field and send them to the conversation. A preview can also prepare a visible draft when the user chooses an option:

```js
parent.postMessage({ type: 'apex:feedback', text: 'Use the conversation layout.' }, '*')
```

The host accepts up to 4,000 characters from that preview's frame. It preserves text the user has edited and requires the user to click **Send feedback**. Generated scripts cannot send chat messages automatically. Clearing the feedback field allows another preview choice to prepare a draft.
