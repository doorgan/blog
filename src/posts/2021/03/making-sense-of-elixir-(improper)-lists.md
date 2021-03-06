---
title: "Making sense of Elixir (improper) lists"
date: "2021-03-03"
image: "/assets/img/posts/improper_lists_cover.png"
tags:
  - elixir
---

A deep dive into the implementation of lists in Elixir

<!-- excerpt -->

{% cover_img "improper_lists_cover.png" "[1, 2, 3, 4 | 5], wft?" %}

# Introduction

In Elixir, we can pattern match a list with `[head | tail] = list`, where `head` is the first element, and `tail` is a list with the rest of the elements. We can prepend to a list with a similar syntax:

```elixir
iex> list = [1, 2, 3, 4]
iex> [5 | list]
[5, 1, 2, 3, 4]
```

We can also join two lists with the `++` operator:

```elixir
iex> left = [1, 2, 3, 4]
iex> right = [5, 6, 7, 8]
iex> left ++ right
[1, 2, 3, 4, 5, 6, 7, 8]
```

But what happens when we try to _append_ to a list?

```elixir
iex> list = [1, 2, 3, 4]
iex> list ++ 5
[1, 2, 3, 4 | 5]
```

Huh. It _kind of_ worked, but there's a weird `|` symbol before the last element.
Moreover, if we try to use a function like `Enum.sum/1`, things will break:

```
iex> Enum.sum([1, 2, 3, 4 | 5])
** (FunctionClauseError) no function clause matching in Enum."-sum/1-lists^foldl/2-0-"/3
```

We get a slightly different result if we try with the `[head | tail]` syntax:

```elixir
iex> list = [1, 2, 3, 4]
iex> [list | 5]
[[1, 2, 3, 4] | 5]
```

It's still not exactly what we want.

What does the `|` even mean here? If we search the internets, we would probably find an answer like:

> What you see there is an improper list. (linked) Lists in elixir are made of a term and a pointer to the next element in the linked list, called a cons cell. Lists where the second element of the last cell is not the empty list is called an improper list.

The Elixir docs on lists provide a similar description:

> Similarly, we could write the list [1, 2, 3] using only such pairs (called cons cells):

```elixir
[1 | [2 | [3 | []]]]
[1, 2, 3]
```

> Some lists, called improper lists, do not have an empty list as the second element in the last cons cell:

```elixir
[1 | [2 | [3 | 4]]]
[1, 2, 3 | 4]
```

With this knowledge, we could say to ourselves that "If we want to append to a list, we need to make sure the last element is a list too", write something in the lines of `list ++ [5]` and call it a day. So, in a nutshell, lists are linked lists, the last element of the last cell needs to be the empty list in order to be a _proper_ list, otherwise it's an _improper_ list, and most of the time you don't want improper lists.

This can leave us with a bitter taste in our mouths, though. Why does Elixir allow us to build improper lists so easily, accidentally even, if we are almost immediately told to not use them? Most of the time we don't want them and they break our code, so what's their purpose?

In the following paragraphs I will try to explain how lists are built from it's most basic elements, some differences in the Erlang and Elixir terminology, and how Erlang exploits improper lists to speed up the creation of IO Lists.

# Cons cells

Many of the Erlang developers back in the day were lisp hackers, and they drew a lot of inspiration from lisps when designing lists.

One of the most fundamental functions in lisp is `cons`: it **cons**tructs a memory object pointing to two elements. It basically builds _pair_, also known as a _cons cell_. It's used as `(cons a b)` and it's usually read as _"to cons a onto b"_, where `a` is the first element -also known as head or car- and `b` is the second element -the tail or cdr(car and cdr stand for **c**ontents of the **a**ddress part of the **r**egister and **c**ontents of the **d**ecrement part of the **r**egister, respectively). For the rest of the article I will call them `head` and `tail` respectively, which are the terms most commonly used in Elixir and Erlang.

There's a special notation for cons cells called _dotted pairs_ that represent the head and the tail more explicitly: `(a . b)`. In the same spirit, the syntax for creating a cons cell in Elixir is `[a | b]`, where the pipe `|`, commonly referred to as the _cons operator_ is akin to the dot in dotted pairs.

If you want to get the head or the tail of a cons cell, you can use the `hd/1` and
`tl/2` functions respectively:

```elixir
iex> cons = [:a | :b]
iex> hd cons
:a
iex> tl cons
:b
```

Or you could also just pattern match against it:

```elixir
iex> [head | tail] = cons
iex> head
:a
iex> tail
:b
```

This was showcased at the start of the article, but note this time we are working at a more basic level, where head and tail can be anything.

## Cons cells vs tuples

We could ask ourselves "why use cons cells when they're identical to 2-tuples?". The main difference lies in their memory layout, as explained in [BEAM VM Wisdoms](https://beam-wisdoms.clau.se/en/latest/) article on [Data Types Memory Layout](https://beam-wisdoms.clau.se/en/latest/indepth-memory-layout.html).

On one hand, cons cells in the heap use two memory words pointing to the head and the tail respectively. In the case of lists the tail points to the next cons cell, thus connecting the tail of a cons cell to an existing list and reusing existing data becomes easy. Consider the lists `a = [1 | [2 | []]]` and `b = [3 | [4 | []]]`. If we want to join them, we just need to replace inner tail in `a` with `b`, ie _connecting the tail to an existing list_. By doing this just one cons cell is "changed" and the second list is reused to create a bigger list.

On the other hand, a tuple uses one word in the heap as a header and the rest of the words correspond to the tuple's elements. This allows tuples to have constant time access at an arbitrary index, but makes changing it's size a more expensive operation. Consider the tuple `{1, 2, 3}`. Since the tuple elements are stored in contiguous places in memory, if we want to add or remove an element to it a new memory space needs to be allocated, the tuple contents copied into them, and a new header is also required. For this reason tuples are mostly used for collections of fixed size and other data structures are utilized when dealing with collections of dynamic length.

Because cons cells lack a header word, they also use less memory, which makes them more convenient for large collections than 2-tuples.

A quick and dirty demonstration of this difference can be done with `:erts_debug.size/1`, which returns the size of a term in words:

```elixir
iex> :erts_debug.size([:a |:b])
2
iex> :erts_debug.size({:a, :b})
3
```

---

In summary, cons cells are ordered pairs, and that's pretty much all there is to them. Things get more interesting when they're used to build more complex data structures.

# Lists and the empty element

Now that we know what cons cells are, how do we build lists with them? If we use the `head` to hold an element of the list and make the `tail` point to the next cons cell, we should be able to build a linked list. If we were to write a typespec for it, it would look something like this: `list :: [term | list]`.

If we have the elements `1`, `2` and `3`, then `1` would point to `2` and then to `3`. We could write that as `[1 | [2 | 3]]`, but while that indeed creates a sequence, tails are required to be cons cells. There is a problem though: a cons cell is made of two elements, but we only have one at the end: the `3`. Moreover, in the above typespec there's no way to tell when the list stops as it keeps pointing to itself, infinitely. We're missing a _terminal element_ in our definition to let us know when we're done with the list.

In lisp and functional programming jargon, this terminal element is usually called `nil`. Adding it to our typespec it would become `list :: nil | [term | list]`, which reads as "A list is either nil(the terminal element), or a cons cell where the head is any term and the tail is a list". In languages that make use of Algebraic Data Types like Haskell, the type signature would be `List a = Nil | Cons a (List a)` which essentially means the same thing. In Erlang syntax, the literal `nil` is an atom. We _could_ use that in our own list-like definition, but it turns out Erlang already implements a special data type for this particular use case. It's called _nil_ too, and it's represented by a pair of square brackets `[]`, which is also close to the lisp notation `()` for the same data type. Therefore the spec would really look like `list :: [] | [term | list]`.

The recursive nature of the data structure hints us to a recursive solution if we want to traverse it. For example, if we wanted to write a function to find an element that matches a predicate, it would look like this:

```elixir
def find([], _), do: {:error, :not_found}
def find([head | tail], predicate) do
  if predicate.(head) do
    {:ok, head}
  else
    find(tail, predicate)
  end
end
```

Note that the function headers match the two possible values for a list: a cons cell or the `nil` element(`[]`).

## Erlang's nil vs Elixir's nil

In Erlang there's no concept of `nil` like in Elixir to denote the absence of a value. `nil` is just an atom in both languages, but Elixir gives it a special meaning. In Elixir `nil` has the special property of being, in combination with the atom `false`, the only falsy values in the language. It's also used as a convention to represent the absence of a value, but this convention does not exist in Erlang.

The `[]` value, normally called _empty list_, is a special value whose only purpose is to be the terminal element for this kind of recursive data structures. If you try to check that `[]` is a list, you would get a positive result:

```elixir
iex> is_list([])
true
```

The reason is that `[]` is one of the two possible values for a list(remember the definition: a cons cell or nil). Despite `[]` being a special data type, the Elixir docs don't regard it as one. For example, the Elixir docs on data types comparison order tell us:

> The reason we can compare different data types is pragmatism. Sorting algorithms don’t need to worry about different data types in order to sort. The overall sorting order is defined below:
>
> `number < atom < reference < function < port < pid < tuple < map < list < bitstring`

`list` is the only list type mentioned, and we could think that `[]` is indeed a list, nothing seems to say the opposite. However, if we look at the same explanation but in the Erlang docs:

> The following order is defined:
>
> `number < atom < reference < fun < port < pid < tuple < map < nil < list < bit string`

There's a subtle difference: there's an additional type `nil` that's listed as a separate type from `list`. The docs further explain:

> nil in the previous expression represents the empty list ([]), which is regarded as a separate type from list/0. That is why nil < list.

Even more interesting is the fact that there exists a dedicated opcode in the BEAM to check for `nil`, as shown in the [BEAM Instructions section of BEAM VM Wisdoms](http://beam-wisdoms.clau.se/en/latest/indepth-beam-instructions.html), and also showcased by [Isaac Yonemoto](https://twitter.com/DNAutics) in his [is_nil BEAM opcode for Elixirists](https://www.youtube.com/watch?v=nebDOqU0TJ0) video.

This is a minor detail, really, but I find it interesting because it's one of those cases where Erlang and Elixir differ in their terminology: `nil` means completely different things for each language.

---

Let's remind ourselves the lists type: `list :: [] | [term | list]`.

Based on this, our list with the elements `1`, `2` and `3` would be written as `[1 | [2 | [3 | []]]]`, and we arrived at the same expression showcased by the docs. Of course, manually writing lists as a succession of cons cells is cumbersome and prone to errors, so usually an alternative syntax is provided to build lists: `[1, 2, 3]`. This is the syntax we're used to and use every day.

However, since lists are a essentially nested cons cells nothing stops us from creating `[1 | [2 | 3]]` like we did before. It may not be what we want most of the time, but it's a perfectly valid data structure. It's not a list as we defined them, it lacks the terminal element `[]` at the end of the chain, so it receives the name of _improper_ list, and lists that follow our previous definition are called _proper_ lists.

## Improper lists

Improper lists are just lists that lack the `[]` as a tail for their last cons cell. If we define improper lists as the opposite of a proper list, then we could say that improper lists are any combination of cons cells that are not a list. For example, `[[1 | 2] | 3]` is not a list, therefore it is an improper list. That example is just an arrangement of pairs, so if we squint our eyes enough it's also a representation of a binary tree:

```
   *
  / \
 *   3
/ \
1 2
```

`[1, 2, 3]` is the syntax for a proper list, but if we inspect `[1 | [2 | 3]]`, we will see `[1, 2 | 3]` instead. Why does this happen? Let's look at one of our first examples in the introduction: `[1, 2] ++ 3`.

When we use the `++` operator, it replaces the terminal element of the left hand side with the value of the right hand side. If we have the list `[1, 2]` -that is `[1 | [2 | []]]` written as cons cells- and we want to append `[3, 4]` to it, what happens when we do `[1, 2] ++ [3, 4]` is that the `[]` in `[2 | []]` gets replaced by `[3, 4]`, resulting in the list `[1, 2, 3, 4]` (remember how we said cons cells make it easy to connect the tail of a cons cell to an existing list?). If we were to write our own append function, it would look something like this:

```elixir
def append([head | []], list), do: [head | list]
def append([head | tail], list), do: [head | append(tail, list)]
```

We recurse over the list, and we replace the terminal `[]` with the list to be appended. The entire list at the left hand side needs to be traversed until the end, so appends will have a linear time complexity.

This function will break in some cases where the `++` operator would work though, which highlights some funny behaviours:
```elixir
iex> append([], :oops)
** (FunctionClauseError) no function clause matching in append/2

iex> [] ++ :oops
:oops
```
The first case is expected, but the second one is a rather funny one, and it makes sense, too. If we were to add a clause to our function to handle the empty list case:
```elixir
def append([], list), do: list
```
We're essentially returning the right hand side, meaning that `append([], whatever)` will always return the second argument. The Erlang devs were aware of this, and the fact that you can accidentally create improper lists with this method, and wrote in the `erlang:'++'/2` function source:

> Adds a list to another (LHS ++ RHS). For historical reasons this is implemented by copying LHS and setting its tail to RHS without checking that RHS is a proper list. [] ++ 'not_a_list' will therefore result in 'not_a_list', and [1,2] ++ 3 will result in [1,2|3], and this is a bug that we have to live with.

The "without checking that RHS is a proper list" part is due to the fact that traversing the whole list to know if it's a proper one(basically check if the tail of the last most cons cell is `[]`) when constructing every list element would cost performance.

---

Prepending to a list is easier, as we just need to create a new cons cell that points to an existing list:

```elixir
iex> list = [1, 2, 3]
iex> [0 | list]
[0, 1, 2, 3]
```

Cons cells creation is done in constant time, and this is the reason why people say prepending to a linked list is faster.

If we try to append `3` to `[1, 2]`, doing `[1, 2] ++ 3` will return `[1, 2 | 3]`; the `[]` was replaced by `3`, thus turning it into an improper list, as hinted by the `|` at the end. In general, whenever you see the pipe at the end of a list it means you've done something wrong and accidentally created an improper list. In a way, it's like the language saying "I could pretty print the list until this point, but since it's no longer a proper list I will just print the cons cell as is".
The reason why you need to wrap a value in a list before appending it to another list, ie: `[1, 2] ++ [3]` should be clearer now.

# Improper lists as an optimization technique

We've already seen what makes a list(cons cells and the terminal element), and have discussed a little bit about the properties of two of their most common operations: append and prepend.

We said that appending to a linked list has linear time complexity: the longer the list, the more time it takes to append an element to it, or to join two lists together. If we need to build a list by appending elements, we would be in trouble.

Let's say we're building a large list by appending elements to it to write to a file or any other kind of IO operation. For the sake of demonstration we'll just use a sequence of strings, essentially rebuilding the list we were given as input, but in real life this would be some non trivial data, like the results of compiling a phoenix template.

A first approximation would be:

```elixir
Enum.reduce(~w[a b c d e f], [], fn n, acc ->
  acc ++ [n]
end)
["a", "b", ...]
```

However, we're traversing the whole accumulator in each iteration. We could do better by building the list in reverse and correcting the ordering afterwards:

```elixir
Enum.reduce(~w[a b c d e f], [], fn n, acc ->
  [n | acc]
end)
|> Enum.reverse()
["a", "b", ...]
```

However, this would still be slow for very large lists.

Luckily, there's a clever trick we can use by taking advantage of improper lists. Remember that lists are basically nested cons cells, and that the creation of cons cells happens in constant time. We could exploit this fact by consing the new elements at the tail instead of the head:

```elixir
Enum.reduce(~w[a b c d e f], [], fn n, acc ->
  [acc | n]
end)
[[[["a"] | "b"] | "c"] | ... ]
```

Of course this is no longer a proper list and we end up with a funny nesting at the head of the cons cells, but we're able to append elements in constant time!

We can also prepend to this improper list in constant time:

```elixir
["zzz" | [[["a"] | "b"] | "c"]]
```

This kind of arrangement is known as an IO List. It's elements are either integers from `0` to `255`, binaries, other IO Lists, or a combination of these. `[0, 15, ["hello" | "elixir"], "world" | "!!!"]` is another example of an IO List, and while IO Lists are not required to be improper lists, they are a very neat trick to quickly append elements to them. At first they may seem like a lot of gibberish, with lots of nesting and hard to traverse. In most cases this is true, but when you need to join a large number of binaries where there may also be a lot of repetition, this technique has huge benefits. Concatenating two binaries requires allocating a new space in memory to hold the new binary, and IO Lists avoid that issue by deferring the creation of large binaries. Moreover, many of the lower level erlang functions know how to handle IO Lists, so the nesting isn't an issue.

For instance the above IO List can be printed as a binary by doing:

```elixir
iex> :erlang.iolist_to_binary ["zzz" | [[["a"] | "b"] | "c"]]
"zzzabc"
```

There's an article by Evan Miller called [Elixir RAM and the Template of DOOM](https://www.evanmiller.org/elixir-ram-and-the-template-of-doom.html) that does a really good job at demonstrating the issues with concatenating lots of repeated data and how IO Lists can greatly increase performance in those cases.

## The IO Lists definition

IO Lists are lists, maybe improper, that contain numbers from `0 to 255`(a byte), binaries, nil or other iolists. So let's try a couple of them with `:erlang.iolist_to_binary/1`:
```elixir
iex> :erlang.iolist_to_binary(["foo", "bar"])
"foobar"

iex> :erlang.iolist_to_binary(["hello " | "world"))
"hello world"

iex> :erlang.iolist_to_binary ["zzz" | [[["a"] | "b"] | "c"]]
"zzzabc"

iex> :erlang.iolist_to_binary([0, 15, ["hello" | "elixir"], "world" | "!!!"])
<<0, 15, 104, 101, 108, 108, 111, 101, 108, 105, 120, 105, 114, 119, 111, 114, 108, 100, 33, 33, 33>>

iex> :erlang.iolist_to_binary([[1 | 2] | [3 | 4])
** (ArgumentError) argument error
    :erlang.iolist_to_binary([[1 | 2], 3 | 4])
```

Huh. It didn't like that last one, and the error message isn't clear at all. Clearly we did something wrong, but the reason is not obvious, so let's try narrow the cause by trying with simpler lists:

```elixir
iex> :erlang.iolist_to_binary([1 | "2"])
<<1, 50>>

iex> :erlang.iolist_to_binary([1 | 2])
** (ArgumentError) argument error
    :erlang.iolist_to_binary([1 | 2])
```
It seems to break when the tails are numbers. That's weird, because by the definition we were given, it should work.

It turns out that IO Lists definitions are a bit complicated. There's a comment in the [Erlang source code](https://github.com/erlang/otp/blob/26150b438fa1587506a020642ab9335ef7cd3fe2/erts/emulator/beam/utils.c#L4284-L4315) that is quite enlightening:

```
iohead ::= Binary
       |   Byte (i.e integer in range [0..255]
       |   iolist
       ;

iotail ::= []
       |   Binary
       |   iolist
       ;

iolist ::= []
       |   Binary
       |   [ iohead | iotail]
       ;
```

According to that definition, only cons cell heads can have numbers, while the tails are only allowed nil, binaries and other IO Lists. This explains why lists such as `[1 | "2"]` work: the head is a number(it complies the `iohead` type) and the tail is a binary(it complies with the `iotail` type), while `[1 | 2]`fails: the tail is a number, which is not allowed in `iotail`.

This is also expressed in the typespec for the `iolist`, but in a more cryptic way:
```elixir
iolist() :: maybe_improper_list(byte() | binary() | iolist(), binary() | [])
```

The `maybe_improper_list` type is not well documented, but it works more or less like this: in the type `maybe_improper_list(a, b)`, `a` represents the contents of the list, ie the head of the cons cells, and `b` represents the termination of the list, ie the contents of the last most tails. In the above typespec, the heads of iolists can be bytes, binaries or other iolists, and the last most tails can be binaries or nil.

In other words, when working with IO Lists, make sure your tails aren't numbers, or things will break in ways that can be hard de debug without a rather deep knowledge of the BEAM innards.

# Summary

Lists, both proper and improper, are made of two basic types in the BEAM: cons cells and nil/empty list. Proper lists are a special arrangement of these two types where the tail of the cons cells point to another cons cell or the empty list. Every other case is considered an improper list. `[a | b]` is the syntax for a cons cell, and we can use it to pattern match against lists, or to prepend elements to a list.

When appending to lists with the `++` operator, we have to make sure that the right hand side is also a list, otherwise we will accidentally create an improper lists. Despite of this minor annoyance, improper lists are a very important data structure in the BEAM, and we can see them in action when appending new elements to IO Lists.

At the end of the day, most of the details explained in this article aren't needed for your day to day Elixir coding, but I hope this knowledge will provide you with a more solid understanding of the language constructs, so the next time you see the `|` in your lists you will know how to *proper*ly read it.

# References

- [Elixir docs: List](https://hexdocs.pm/elixir/List.html)
- [Cons - Wikipedia](https://en.wikipedia.org/wiki/Cons)
- [Elixir term ordering](https://hexdocs.pm/elixir/master/operators.html#term-ordering)
- [Erlang term comparisons](https://erlang.org/doc/reference_manual/expressions.html#term-comparisons)
- [Data Types Memory Layout](https://beam-wisdoms.clau.se/en/latest/indepth-memory-layout.html)
- [is_nil BEAM opcode for Elixirists](https://www.youtube.com/watch?v=nebDOqU0TJ0)
- [BEAM Instruction codes](https://beam-wisdoms.clau.se/en/latest/indepth-beam-instructions.html)
- [James Edward Gray II on using improper lists to quickly append elements](https://elixirforum.com/t/weird-sasl-lists-and-can-i-rely-on-kernel-is-list/470/7)
- [Elixir RAM and the Template of DOOM](https://www.evanmiller.org/elixir-ram-and-the-template-of-doom.html)
- [iolist type definition in Erlang `iolist_to_buf` C function source code](https://github.com/erlang/otp/blob/26150b438fa1587506a020642ab9335ef7cd3fe2/erts/emulator/beam/utils.c#L4284-L4315)
