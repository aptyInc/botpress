export const wrapper = (fn: any) => {
  return (req, res, next) => {
    fn(req, res, next).catch(error => next(error))
  }
}

export const serverError = (error, req, res) => {
  // @ts-ignore
  if (process.env.NODE_ENV === 'production') {
    return res.status(500).send(`something went wrong`)
  }
  console.error(error.stack)
}
