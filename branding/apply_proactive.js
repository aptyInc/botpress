if (event.type === 'proactive-trigger') {
  console.log('proactive-trigger')
  const eventDestination = {
    channel: event.channel,
    target: event.target,
    botId: event.botId,
    threadId: event.threadId
  }

  if (event.state.session.lastMessages.length) {
    event.setFlag(bp.IO.WellKnownFlags.SKIP_DIALOG_ENGINE, true);
    bp.cms.renderElement('builtin_text', { text: "Hello, Welcome to apty automation.", typing: true }, eventDestination).then(payloads => {
      bp.events.replyToEvent(event, payloads)
    })
  }
}
