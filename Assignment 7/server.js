const express = require('express');
const mongoose = require('mongoose');

const app = express();
const PORT = 3000;

app.use(express.json());

mongoose.connect('mongodb://localhost:27017/product_db')
  .then(() => console.log('Connected to MongoDB...'))
  .catch(err => console.error('Could not connect to MongoDB...', err));

const ProductSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  description: String,
  category: { type: String, required: true },
  stock: { type: Number, default: 0, min: [0, 'Stock cannot be negative'] }
});

const Product = mongoose.model('Product', ProductSchema);

app.post('/products', async (req, res) => {
  try {
    const product = new Product(req.body);
    await product.save();
    res.status(201).json(product);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.get('/products', async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(product);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.patch('/products/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(product);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete('/products/:id', async (req, res) => {
  try {
    const deletedProduct = await Product.findByIdAndDelete(req.params.id);

    if (!deletedProduct) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/products/search/:keyword', async (req, res) => {
  try {
    const products = await Product.find({
      name: { $regex: req.params.keyword, $options: 'i' }
    });

    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/products/category/:category', async (req, res) => {
  try {
    const products = await Product.find({ category: req.params.category });

    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/products/available', async (req, res) => {
  try {
    const products = await Product.find({
      stock: { $gt: 0 }
    });

    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.patch('/products/:id/add-stock', async (req, res) => {
  try {
    const amount = req.body.amount;

    if (amount === undefined || amount <= 0) {
      return res.status(400).json({ message: 'Amount must be greater than 0' });
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { $inc: { stock: amount } },
      { new: true, runValidators: true }
    );

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(product);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}...`));
