import { Router } from 'express'
import moment from 'moment'
import { sendMail } from '../../functions/sendMail.js'
import User from '../../models/user.js'
import Order from '../../models/order.js'
import Product from '../../models/product.js'
import Delivery from '../../models/delivery.js'
import { ensureAuthenticatedAPI } from '../../functions/ensureAuthenticatedAPI.js'
const router = Router()
let responseJson
moment.locale('cs')

// POST /api/scannerOrder - validate product price and purchase product if it matches
router.post('/', ensureAuthenticatedAPI, function (req, res) {
  if (!req.body.customer) {
    // Check if request contains 'customer' parameter
    res.status(400)
    res.set('Content-Type', 'application/problem+json')
    responseJson = {
      type: 'https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#scannerOrder',
      title: "Your request does not contain parameter 'customer'.",
      status: 400,
      'detail:': "This function requires parameter 'customer'.",
      'invalid-params': [
        {
          name: 'customer',
          reason: 'must be specified'
        }
      ]
    }
    res.json(responseJson)
    return
  } else if (!req.body.product) {
    // Check if request contains 'product' parameter
    res.status(400)
    res.set('Content-Type', 'application/problem+json')
    responseJson = {
      type: 'https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#scannerOrder',
      title: "Your request does not contain parameter 'product'.",
      status: 400,
      'detail:': "This function requires parameter 'product'.",
      'invalid-params': [
        {
          name: 'product',
          reason: 'must be specified'
        }
      ]
    }
    res.json(responseJson)
    return
  } else if (!req.body.price) {
    // Check if request contains 'price' parameter
    res.status(400)
    res.set('Content-Type', 'application/problem+json')
    responseJson = {
      type: 'https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#scannerOrder',
      title: "Your request does not contain parameter 'price'.",
      status: 400,
      'detail:': "This function requires parameter 'price'.",
      'invalid-params': [
        {
          name: 'price',
          reason: 'must be specified'
        }
      ]
    }
    res.json(responseJson)
    return
  }

  const newOrder = new Order()

  // Find user by keypadId
  const filter =
    req.body.customer.toString().length < 6
      ? {
          keypadId: Number(req.body.customer),
          keypadDisabled: { $in: [null, false] }
        }
      : { card: req.body.customer.toString() }
  User.findOne({
    ...filter
  })
    .then((user) => {
      if (!user) {
        res.status(404)
        res.set('Content-Type', 'application/json')
        res.json('USER_NOT_FOUND')
        return
      }

      newOrder.buyerId = user._id
      newOrder.scannerOrder = true

      // Get product
      Product.aggregate([
        {
          $match: {
            code: req.body.product.toString()
          }
        },
        {
          $lookup: {
            from: 'deliveries',
            localField: '_id',
            foreignField: 'productId',
            as: 'stock'
          }
        },
        {
          $project: {
            keypadId: '$keypadId',
            displayName: '$displayName',
            description: '$description',
            imagePath: '$imagePath',
            stock: {
              $filter: {
                // We filter only the stock object from array where ammount left is greater than 0
                input: '$stock',
                as: 'stock',
                cond: {
                  $gt: ['$$stock.amount_left', 0]
                }
              }
            }
          }
        }
      ])
        .then((product) => {
          if (typeof product[0] === 'undefined') {
            res.status(404)
            res.set('Content-Type', 'application/json')
            res.json('PRODUCT_NOT_FOUND')
            return
          } else if (typeof product[0].stock[0] === 'undefined') {
            res.status(404)
            res.set('Content-Type', 'application/json')
            res.json('STOCK_NOT_FOUND')
            return
          } else if (product[0].stock[0].price !== req.body.price) {
            res.status(400)
            res.set('Content-Type', 'application/json')
            res.json('PRICE_MISMATCH')
            return
          }

          newOrder.deliveryId = product[0].stock[0]._id
          const newAmount = product[0].stock[0].amount_left - 1

          Delivery.findByIdAndUpdate(product[0].stock[0]._id, {
            amount_left: newAmount
          })
            .then((delivery) => {
              newOrder
                .save()
                .then((order) => {
                  const subject = `Potvrzení objednávky - ${product[0].displayName}`
                  const mailPreview = `Zakoupili jste ${product[0].displayName} za ${delivery.price} Kč přes API.`
                  sendMail(
                    user.email,
                    'productPurchased',
                    {
                      subject,
                      mailPreview,
                      orderId: order._id,
                      productId: delivery.productId,
                      productName: product[0].displayName,
                      productPrice: delivery.price,
                      purchaseDate: moment(order.order_date).format('LLLL')
                    },
                    product[0].imagePath
                  )

                  res.status(200)
                  res.set('Content-Type', 'application/json')
                  responseJson = {
                    user: {
                      displayName: user.displayName,
                      email: user.email
                    },
                    product: {
                      name: product[0].displayName,
                      price: product[0].stock[0].price
                    }
                  }
                  res.json(responseJson)
                })
                .catch((err) => {
                  res.status(err.status || 500)
                  res.set('Content-Type', 'application/json')
                  res.json('SYSTEM_ERROR')

                  const subject = '[SYSTEM ERROR] Chyba při zápisu do databáze!'
                  const message = `Potenciálně se nepodařilo zapsat novou objednávku do databáze, ale již došlo k ponížení skladové zásoby v dodávce ID [${delivery._id}]. Zákazník ID [${user._id}], zobrazované jméno [${user.displayName}] se pokusil koupit produkt ID [${product[0]._id}], zobrazované jméno [${product[0].displayName}] za [${delivery.price}] Kč. Zkontrolujte konzistenci databáze.`
                  sendMail('system@system', 'systemMessage', {
                    subject,
                    message,
                    messageTime: moment().toISOString(),
                    errorMessage: err.message
                  })
                })
            })
            .catch((err) => {
              res.status(err.status || 500)
              res.set('Content-Type', 'application/json')
              res.json('SYSTEM_ERROR')

              const subject = '[SYSTEM ERROR] Chyba při zápisu do databáze!'
              const message = `Potenciálně se nepodařilo snížit skladovou zásobu v dodávce ID [${newOrder.deliveryId}] a následně vystavit objednávku. Zákazník ID [${user._id}], zobrazované jméno [${user.displayName}] se pokusil koupit produkt ID [${product[0]._id}], zobrazované jméno [${product[0].displayName}]. Zkontrolujte konzistenci databáze.`
              sendMail('system@system', 'systemMessage', {
                subject,
                message,
                messageTime: moment().toISOString(),
                errorMessage: err.message
              })
            })
        })
        .catch((err) => {
          res.status(err.status || 500)
          res.set('Content-Type', 'application/json')
          res.json('SYSTEM_ERROR')
        })
    })
    .catch(() => {
      res.status(400)
      res.set('Content-Type', 'application/problem+json')
      const responseJson = {
        type: 'https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#scannerOrder',
        title: "Your parameter 'customer' is wrong type.",
        status: 400,
        'detail:':
          "Parameter 'customer' must be a 'Number'. More details can be found in documentation https://git.io/Jey70",
        'invalid-params': [
          {
            name: 'customer',
            reason: 'must be natural number'
          }
        ]
      }
      res.json(responseJson)
    })
})

export default router
