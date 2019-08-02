if (event.type === 'proactive-trigger') {
  console.log('proactive-trigger')
  const eventDestination = {
    channel: event.channel,
    target: event.target,
    botId: event.botId,
    threadId: event.threadId
  }

  event.setFlag(bp.IO.WellKnownFlags.SKIP_DIALOG_ENGINE, true);
  bp.cms.renderElement('builtin_text', { text: "I'm so proactive!", typing: true }, eventDestination).then(payloads => {
    bp.events.replyToEvent(event, payloads)
  })
}
