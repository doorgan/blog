---
title: "A deep dive into the Elixir AST"
date: "2021-04-16"
image: "/assets/img/posts/a_deep_dive_into_the_elixir_ast_cover.png"
tags:
  - elixir
  - ast
  - macros
---

Exploring in detail the Elixir AST, and then using it to build a macro and a static code checker.

<!-- excerpt -->

{% cover_img "a_deep_dive_into_the_elixir_ast_cover.png" "iex> quote do: sum(1, 2, 3); {:sum, [], [1, 2, 3]" %}

Before I start, I want to thank GenericJam from the [Elixir Discord server](https://discord.com/invite/elixir) for motivating me to write this article, and Łukasz Jan Niemier (aka @hauleth) for pointing me to the missing pieces I needed to have a complete picture of the AST shape.

---

This article was split into three parts:

- [Part one: The Elixir AST](/posts/2021/04/the_elixir_ast/)
- [Part two: The Elixir AST: Building a typed struct macro](/posts/2021/04/the_elixir_ast_typedstruct/)
- [Part three: The Elixir AST: Building a static code analyzer](/posts/2021/04/the_elixir_ast_analyzer/)

---

Metaprogramming is an important feature in Elixir. It gives you the ability to write code that, when compiled, gets transformed into a different version of itself. This kind of code is called a _macro_, and is popullarily referred to as "code that writes code".

For this to work, a macro needs to have access to the language's internal representation of the source code. This is typically a tree-shaped data structure called an _Abstract Syntax Tree_. For example, the expression `1 + 2 * 4` would be conceptually represented by this tree:

```
  +
 / \
1   *
   / \
  2   4
```

In many progrmaming languages the AST representation of the code is hidden from the user, but Elixir makes it available to you and it even allows you to manipulate it at will. A macro would receive that tree, process it, and output a new version, adding or removing elements from the tree, or just analyzing it. For instance, it could compute the result of the expression at compile time, and turn the previous example tree into just `9`. A real-life example of macros are the functions from the `Logger` module. The [`Logger.debug/2`](https://hexdocs.pm/logger/Logger.html#debug/2) macro will emit a debug level message during development, but it will be completely removed from your code in a production environment. To take things even further, many of Elixir's basic building blocks are implemented as macros themselves, like `defmodule`, `def`, and even `defmacro`.

Being such an important aspect of the language, Elixir provides tools to work with the AST, in a way that it's not only limited to macros. There are tools to parse a string into an Elixir AST and to aid in its traversal which, among other use cases, also enables you to perform static code analysis of Elixir source code.

Whether you want to write a macro or to analyze Elixir code, you will be working with its AST representation. Getting comfortable with reading and writing it is vital for this kind of task, and that's where the focus of this article will be. I'm not going to focus on the process of evaluating when a macro is needed or how to design it, but in analyzing the AST they receive. I will first attempt to cover what the AST looks like, what kind of shapes and combinations are possible, and then we will apply that to build two little projects: a macro to generate typed structs, and a little code style checker.

## The AST

To know what is the AST representation of some Elixir code, we can use the [quote/2](https://hexdocs.pm/elixir/Kernel.SpecialForms.html#quote/2) macro:

```elixir
quote do
  "Hello world!"
end
#=> "Hello world!"
```

In this example the expression was just a string literal, which is represented by itself in the AST. This is usually the case for the _leaf_ nodes in the AST, and I will expand on this later. For now, let's try with a slightly more complicated example:

```elixir
quote do
  1 + 2
end
#=> {:+, [], [1, 2]}
```

That 3-tuple is representing this AST node:

```md
   +
  / \
  1 2
```

What can be inferred here is that non-leaf AST nodes are represented as three element tuples, where the first element is an expression identifying the node type, and the last element is a list of children. The middle element is a list with _metadata_ about the node, like the line number and column. We'll see more examples of metadata through the article, but for now it can be ignored. In most examples the metadata will be an empty list for the sake of brevity, but I will actually use it later in the code style checker section.

With those two examples, it should be possible to understand the `1 + 2 * 4` expression's AST:

```elixir
quote do
  1 + 2 * 4
end
#=> {:+, [], [1, {:*, [], [2, 4]}]}
```

First, the outer tuple `{:+, [], [...]}` is the call to `+/2`, then the children are the literal `1` and a call to `*/2`, with `2` and `4` as its children.

Since `quote/2` is the primitive by which code is turned into data, Elixir calls the AST a _quoted expression_. The AST term has the advantage of familiarity among developers, so most of the time both terms are use interchangeably, even in the official Elixir documentation.

One thing to note so far is that some literals are expressed by themselves. In many languages, literals would have their own representation, for instance in JavaScript the literal `1` would be expressed by the object `{type: 'Literal', value: 1}`, or the `{integer, LineNumber, 1}` tuple in Erlang. This is not the case in Elixir, and one explanation for this is that it makes it easier to work with them in macros, as matching on literals is much less verbose than matching against nested 3-tuples. However, one of the downsides of this is that information about the position or context of a literal is lost.

### What makes an AST

As shown above, some Elixir terms can be represented by themselves. To be precise, these cases are:

- atoms, like `:ok`
- integers, such as `42`
- floats like `13.1`
- strings like `"hello"`
- lists such as `[1, 2, 3]`
- tuples with two elements, like `{"hello", :world}`

<small>Note: This listing is borrowed from the Elixir AST section in the [Elixir syntax reference](https://hexdocs.pm/elixir/master/syntax-reference.html#the-elixir-ast)</small>

This means that trying to quote any of those expressions will result in the expression itself:

```elixir
quote do
  {:foo, :bar}
end
#=> {:foo, :bar}
```

The reason 2-tuples are a special case is that it allows keyword lists to be expressed as literals. It makes it easier to pass options to macros, and it makes it also easier to identify `do`/`end` blocks by pattern matching against `[do: block]`.

Every other kind of expression is represented by a 3-tuple that can represent _variables_ or _calls_.

#### Variables

Variables are represented by a 3-tuple where the first element is an atom representing its name, the second is the node's metadata, and the third is an atom representing the context of the variable:

```elixir
quote do
  foo
end
#=> {:foo, [], Elixir}
```

`quote` will always include the module in which it was called as the variable context. If this code is run in IEx, the context will be `Elixir`. However, if `Code.string_to_quoted!` is used instead, the context will be `nil`, as there was no environment in which the expression was resolved:

```elixir
Code.string_to_quoted!("foo")
#=> {:foo, [line: 1], nil}
```

The resolution context can be injected into a quoted expression with the `:context` option:

```elixir
quote context: Foo do
  bar
end
#=> {:bar, [], Foo}
```

When a macro is encountered by the compiler, it gets _expanded_. That is, the macro gets evaluated and its result gets inserted into the place in the AST where the macro call happened. This happens recursively until there is no macro left to expand. During this process, macros can insert variables into the AST, and their nodes will have the macro module as their context. This context can also be present in the `context` key of some nodes metadata.

The context is useful to keep track what code defined which variables. For instance, consider this macro:

```elixir
defmodule A do
  defmacro demo() do
    quote do
      foo
    end
  end
end
```

If we use it in an expression:

```elixir
require A

A.demo()
```

The `A.demo()` call will get expanded to something like:

```elixir
{:foo, [counter: -576460752303422751], A}
```

The variable AST's context is the module of the macro that defined that variable, and additionally a counter number is inserted into the metadata, which prevents the variable from interfering with variables of the same name defined outside of the scope of the macro once it's evaluated. This is one of the mechanisms by which Elixir achieves hygienic macros: the compiler recognizes variables by `name` and `metadata[:counter]`, or `name` and `context`. The `var!/2` macro [removes this counter](https://github.com/elixir-lang/elixir/blob/98485daab0a9f3ac2d7809d38f5e57cd73cb22ac/lib/elixir/lib/kernel.ex#L3654) from a variable node to mark that it shouldn't be hygienized.

#### Calls

What we saw so far in this section were the _leaf_ nodes of the syntax tree. They represent individual pieces of data that can't be reduced any more to produce a meaningful piece of syntax. We still need to combine them to represent a useful program, and this is achieved with _calls_.
Calls are the basic building block with wich other nodes are combined to build a proper AST. In their most basic form, they look like this:

```elixir
sum(1, 2, 3)
```

And they are represented by a 3-tuple:

```elixir
{:sum, [], [1, 2, 3]}
```

Here the first element is an atom in the case of non-qualified calls like this example, or a tuple representing a call to the `.` operator in the case of qualified calls like `String.downcase("HELLO")`. The second element is again metadata, and the third one is a list of _arguments_.

#### Operators and constructors

Operators like `+` are also represented as non-qualified calls:

```elixir
quote do
  1 + 2
end
#=> {:+, [], [1, 2]}
```

The main characteristic of operators is that Elixir can't parse any arbitrary operator. There is a list of supported operators and their associativities in the [Operators](https://hexdocs.pm/elixir/operators.html) section of the Elixir documentation.

Data structures like maps, tuples and bitstrings are represented with a call where the type is the atom name of their respective special form constructor, and the arguments are their elements.
For example, the following map:

```elixir
%{foo: :bar}
```

Is represented by the call:

```elixir
{:%{}, [], [foo: :bar]}
```

The same goes for tuples of sizes other than 2:

```elixir
quote do
  {1, 2, 3}
end
#=> {:{}, [], [1, 2, 3]}
```

or bitstrings:

```elixir
quote do
  <<1, 2, 3>>
end
#=> {:<<>>, [], [1, 2, 3]}
```

#### Aliases and blocks

Some calls have a special meaning. For example, module names are atoms: `Enum` is actually `:"Elixir.Enum"` under the hood, but they are represented in the AST as an `:__aliases__` call:

```elixir
quote do
  Foo
end
#=> {:__aliases__, [], [:Foo]}
```

The arguments to this call are the segments of a module name:

```elixir
quote do
  Foo.Bar.Baz
end
#=> {:__aliases__, [], [:Foo, :Bar, :Baz]}
```

Another special case is blocks of code. A block is a sequence of two or more expressions, each defined in a different line. It is represented as a `__block__` call, where each line is a separate argument:

```elixir
quote do
  1
  2
  3
end
#=> {:__block__, [], [1, 2, 3]}
```

Elixir also allows you to use a semicolon as a line delimiter, so this expression is equivalent to the previous one:

```elixir
quote do 1; 2; 3; end
#=> {:__block__, [], [1, 2, 3]}
```

#### Left to right arrow

The left to right arrow `->` is a special kind of node. It is represented as non-qualified call, but it can only exist in a list, which suggests that it can only be used as an argument for another call, like clauses for an anonymous function or in a `do` block.
The first argument must always be a list representing its left hand side arguments, and the second one is an expression.

```elixir
quote do
  case 1 do
    2 -> 3
    4 -> 5
  end
end
#=> {:case, [], [1, [do: [{:->, [], [[2], 3]}, {:->, [], [[4], 5]}]]]}

quote do
  cond do
    true -> false
  end
end
#=> {:cond, [], [[do: [{:->, [], [[true], false]}]]]}

quote do
  (1, 2 -> 3
   4, 5 -> 6)
end
#=> [{:->, [], [[1, 2], 3]}, {:->, [], [[4, 5], 6]}]

quote do
  fn
    1, 2 -> 3
    4, 5 -> 6
  end
end
#=> {:fn, [], [{:->, [], [[1, 2], 3]}, {:->, [], [[4, 5], 6]}]}
```

<small>Examples borrowed from the Elixir syntax reference</small>

#### Qualified calls

So far we've seen examples of non-qualified calls, where the first element is an atom. Qualified calls, on the other hand, have a call to the `.` operator as their first element. This kind of call is found when there is a call on the left hand side of the `()` (call) operator. There are two of these situations:

- When the left hand side is another call
- With the `.` operator

The first situation occurs in cases like `foo()()`. Such syntax is invalid in most cases and will fail to compile, but it is possible to use it inside of `quote`, where it is commonly used to compose quoted expressions to generate functions with `unquote`.
Let's look at this example:

```elixir
quote unquote: false do
  unquote(:foo)()
end
#=> {{:unquote, [], [:foo]}, [], []}
```

The `unquote: false` option forces `quote` to interpret `unquote` as a normal call, preventing it from injecting code into our expression, so we can see how it is represented in the AST.
We can see that the first element here is the non-qualified call `{:unquote, [], [:foo]}` instead of an atom.

The second situation is more interesting, and is where things start to get funky. Let's consider the following syntax:

```elixir
foo.bar
```

If we quote it, we get the following AST:

```elixir
{{:., [], [{:foo, [], Elixir}, :bar]}, [no_parens: true], []}
```

There's quite a bit to unpack here.
The first element is a dot operator call, where the left hand side is a variable, and the right hand side is an atom:

```elixir
{:., [], [{:foo, [], Elixir}, :bar]}
```

The outer node is a call with no arguments, but it contains the `no_parens: true` metadata. What this suggests is that every use of the `.` operator will be represented as a call where the parenthesis may be omitted, and the first element will be a dot operator call.

It's not hard to also prove that the dot operator call can be arbitratily nested:

```elixir
quote do
  foo.bar.baz(1, 2, 3)
end

#=>
{
  {:., [], [
    {:., [], [{:foo, [], Elixir}, :bar]}, :baz
  ]}, [], [1, 2, 3]
}
```

Another case for qualified calls is the qualified tuples syntax: `Foo.{Bar, Baz}`. This syntax is most often used when aliasing multiple modules. It's represented in the AST as a `{:., [], [alias, :{}]}` call:

```elixir
quote do
  Foo.{Bar, Baz}
end
#=>
{
  {:., [], [{:__aliases__, [], [:Foo]}, :{}]},
  [],
  [{:__aliases__, [], [:Bar]}, {:__aliases__, [], [:Baz]}]
}
```

The interesting bits here are the arguments to the dot call: the `[alias, :{}]` arguments are the way Elixir uses to recognize qualified tuples as something different from `Foo.{}(Bar, Baz)`.

There's a last case for qualified calls, and this one striked me as odd the first time, because it's not obvious at all that we're dealing with a qualified operator. Let's look at the following quoted expression:

```elixir
quote do
  foo[:bar]
end
#=> {{:., [], [Access, :get]}, [], [{:foo, [], Elixir}, :bar]}
```

What happens here is that the access syntax gets desugared into a qualified call to `Access.get`. The way Elixir recognizes it in the AST is by the `[Access, :get]` arguments for the inner dot call, and it only makes sense to have as many arguments as `Access.get` allows:

```elixir
Macro.to_string({{:., [], [Access, :get]}, [], [{:foo, [], Elixir}]})
#=> "Access.get(foo)"

Macro.to_string({{:., [], [Access, :get]}, [], [{:foo, [], Elixir}, :bar]})
#=> "foo[:bar]"

Macro.to_string({{:., [], [Access, :get]}, [], [{:foo, [], Elixir}, :bar, :baz]})
#=> "Access.get(foo, :bar, :baz)"

Macro.to_string({{:., [], [Access, :get]}, [], [{:foo, [], Elixir}, :bar, :baz, :qux]})
#=> "Access.get(foo, :bar, :baz, :quz)" <-- this will fail
```

---

That should cover most, if not all, of the possible constructs that conform an Elixir AST. Any kind of AST you find will be made of a composition of the nodes mentioned before, and knowing them makes reading it and identifying patterns much more easier.

While knowing the AST structure is very useful for this kind of work, as the code gets more complex it can be hard to guess to which AST construct a piece of syntax will get parsed to. I will try to approach the following sections by destructuring the AST and looking at smaller pieces of it at a time to reinforce ideas, but what I highly recommend is to open an IEx session and start playing around with `quote`, or using the [AST Ninja](https://ast.ninja/) tool by [Arjan Scherpenisse](https://github.com/arjan/ast_ninja).

In the next chapter we will put this knowledge to practice by building a macro that analyzes a piece of syntax to generate typespecs for a struct.

- [Part two: The Elixir AST: Building a typed struct macro](/posts/2021/04/the_elixir_ast_typedstruct/)
- [Part three: The Elixir AST: Building a static code analyzer](/posts/2021/04/the_elixir_ast_analyzer/)
