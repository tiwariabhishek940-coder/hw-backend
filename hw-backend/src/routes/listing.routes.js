const express = require('express');
const { body, query: qv } = require('express-validator');
const { validate }    = require('../middleware/validate');
const { authenticate, requireRole, optionalAuth } = require('../middleware/auth');
const { upload }      = require('../config/cloudinary');
const ctrl            = require('../controllers/listingController');

const router = express.Router();

router.get('/',    optionalAuth, ctrl.getListings);
router.get('/:id', optionalAuth, ctrl.getListing);

router.post('/',
  authenticate, requireRole('seller','admin'),
  upload.array('images', 5),
  [
    body('name').trim().notEmpty().isLength({ max: 200 }),
    body('series').trim().notEmpty(),
    body('rarity').isIn(['Common','Rare','Premium','Treasure Hunt','Super Treasure Hunt']),
    body('condition').isIn(['New (MOC)','Used (Loose)','Damaged']),
    body('price').isInt({ min: 1 }),
  ],
  validate, ctrl.createListing
);

router.patch('/:id', authenticate, ctrl.updateListing);
router.delete('/:id', authenticate, ctrl.deleteListing);

module.exports = router;
