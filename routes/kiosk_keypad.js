import { Router } from 'express'
import { ensureAuthenticated } from '../functions/ensureAuthenticated.js'
const router = Router()

/* GET kiosk shop page. */
router.get('/', ensureAuthenticated, function (req, res) {
  if (!req.user.kiosk) {
    res.redirect('/')
    return
  }
  if (req.session.alert) {
    var alert = req.session.alert
    delete req.session.alert
  }
  res.render('shop/kiosk_keypad', {
    title: 'Kiosek | Lednice IT',
    user: req.user,
    alert
  })
})

export default router
