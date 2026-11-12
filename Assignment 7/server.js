const express = require('express');
const app = express();
app.use(express.json());

// ข้อมูลสินค้าจำลองในระบบ (In-Memory Array) 
let products = [
  {
    _id: "65f3f01b2c3d4e5f6a7b8c91",
    name: "Mechanical Keyboard",
    price: 1890,
    description: "Red switch keyboard",
    category: "Computer",
    stock: 10
  },
  {
    _id: "65f3f01b2c3d4e5f6a7b8c92",
    name: "Gaming Mouse",
    price: 990,
    description: "RGB wireless mouse",
    category: "Computer",
    stock: 5
  }
];

// ขยับฟังก์ชันดักเงื่อนไขพิเศษขึ้นมาด้านบนเพื่อป้องกันปัญหาค้างคัดกรองข้อมูล
app.get('/products/available', (req, res) => {
  const result = products.filter(p => p.stock > 0);
  res.json(result);
});

app.post('/products', (req, res) => {
  const { name, price, description, category, stock } = req.body;
  if (!name || !price || !category) {
    return res.status(400).json({ message: "Product validation failed" });
  }
  const inputStock = stock !== undefined ? stock : 0;
  if (inputStock < 0) return res.status(400).json({ message: "Stock cannot be negative" });

  const newProduct = {
    _id: "65f3f01b2c3d4e" + Math.random().toString(16).substr(2, 10),
    name, price, description: description || "", category, stock: inputStock
  };
  products.push(newProduct);
  res.status(201).json(newProduct);
});

app.get('/products', (req, res) => {
  res.json(products);
});

app.get('/products/:id', (req, res) => {
  const product = products.find(p => p._id === req.params.id);
  if (!product) return res.status(404).json({ message: 'Product not found' });
  res.json(product);
});

app.patch('/products/:id', (req, res) => {
  const product = products.find(p => p._id === req.params.id);
  if (!product) return res.status(404).json({ message: 'Product not found' });

  const { name, price, description, category, stock } = req.body;
  if (name !== undefined) product.name = name;
  if (price !== undefined) product.price = price;
  if (description !== undefined) product.description = description;
  if (category !== undefined) product.category = category;
  if (stock !== undefined) {
    if (stock < 0) return res.status(400).json({ message: "Stock cannot be negative" });
    product.stock = stock;
  }
  res.json(product);
});

app.delete('/products/:id', (req, res) => {
  const index = products.findIndex(p => p._id === req.params.id);
  if (index === -1) return res.status(404).json({ message: "Product not found" });
  products.splice(index, 1);
  res.json({ message: "Product deleted" });
});

app.get('/products/search/:keyword', (req, res) => {
  const keyword = req.params.keyword.toLowerCase();
  const result = products.filter(p => p.name.toLowerCase().includes(keyword));
  res.json(result);
});

app.get('/products/category/:category', (req, res) => {
  const result = products.filter(p => p.category.toLowerCase() === req.params.category.toLowerCase());
  res.json(result);
});

app.patch('/products/:id/add-stock', (req, res) => {
  const product = products.find(p => p._id === req.params.id);
  if (!product) return res.status(404).json({ message: "Product not found" });

  const amount = req.body.amount;
  if (amount === undefined || amount <= 0) return res.status(400).json({ message: "Amount must be greater than 0" });

  product.stock += amount;
  res.json(product);
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}...`));
